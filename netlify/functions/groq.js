// =========================================================================
// >>>>> netlify/functions/groq.js - VERSÃO FINAL E BLINDADA <<<<<
// =========================================================================
const Groq = require('groq-sdk');

// --- CONFIGURAÇÕES VIA VARIÁVEIS DE AMBIENTE (para maior flexibilidade) ---
const MODEL_NAME = process.env.GROQ_MODEL_NAME || 'llama3-8b-8192'; // Padrão para o mais rápido
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GROQ_DEFAULT_TIMEOUT_MS, 10) || 25000; // Padrão 25s
const MAX_RETRIES_BASE = parseInt(process.env.GROQ_MAX_RETRIES_BASE, 10) || 2; // Padrão 2
const BACKOFF_BASE_DELAY_MS = parseInt(process.env.GROQ_BACKOFF_BASE_DELAY_MS, 10) || 1000; // Padrão 1s

// Variável para manter o índice da última chave usada.
// NOTA: Em serverless, isso persiste apenas entre "warm invocations" da mesma instância.
let currentKeyIndex = 0;

/**
 * Função principal do Netlify Function para proxy da API Groq.
 * @param {Object} event - O objeto de evento da função Netlify.
 * @param {Object} context - O objeto de contexto da função Netlify.
 * @returns {Object} A resposta HTTP.
 */
exports.handler = async (event, context) => {
    console.log("--- INICIANDO CHAMADA AO PROXY GROQ ---");

    // 1. VALIDAÇÃO DO MÉTODO HTTP (INEGOCIÁVEL)
    if (event.httpMethod !== 'POST') {
        console.warn("Tentativa de acesso via método não permitido:", event.httpMethod);
        return { statusCode: 405, body: JSON.stringify({ error: { message: 'Method Not Allowed. Use POST.' } }) };
    }

    // 2. VALIDAÇÃO DA VARIÁVEL DE AMBIENTE (CRÍTICO)
    if (!process.env.GROQ_API_KEYS) {
        const errorMsg = "A variável de ambiente GROQ_API_KEYS não está configurada no Netlify.";
        console.error(errorMsg);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: { message: errorMsg } }),
        };
    }

    // 3. PROCESSAMENTO DAS CHAVES DE API (ROBUSTO)
    const rawApiKeys = process.env.GROQ_API_KEYS.split(',');
    const apiKeys = rawApiKeys.map(key => key.trim()).filter(Boolean);
    
    if (apiKeys.length === 0) {
        const errorMsg = "Nenhuma chave de API válida encontrada na variável GROQ_API_KEYS após processamento.";
        console.error(errorMsg, { rawInput: process.env.GROQ_API_KEYS });
        return {
            statusCode: 500,
            body: JSON.stringify({ error: { message: errorMsg } }),
        };
    }
    console.log(`Chaves de API carregadas com sucesso. Total: ${apiKeys.length}`);

    // 4. VALIDAÇÃO DO CORPO DA REQUISIÇÃO (RIGOROSA)
    let requestBody;
    try {
        requestBody = JSON.parse(event.body);
    } catch (parseError) {
        const errorMsg = "Falha ao fazer o parse do corpo da requisição JSON.";
        console.error(errorMsg, parseError.message, event.body);
        return { statusCode: 400, body: JSON.stringify({ error: { message: `Bad Request: ${errorMsg}` } }) };
    }

    const { prompt, maxTokens } = requestBody;
    if (!prompt) {
        const errorMsg = "Prompt ausente no corpo da requisição.";
        console.error(errorMsg, { receivedBodyKeys: Object.keys(requestBody || {}) });
        return { statusCode: 400, body: JSON.stringify({ error: { message: `Bad Request: ${errorMsg}` } }) };
    }
    console.log("Prompt recebido com sucesso. Tamanho:", prompt.length, "chars.");

    // --- CONFIGURAÇÕES PARA ESTA CHAMADA ESPECÍFICA ---
    const effectiveMaxTokens = maxTokens || 2048;
    const effectiveMaxRetries = Math.min(apiKeys.length, MAX_RETRIES_BASE);
    console.log(`Configurações para esta chamada: Max Tokens=${effectiveMaxTokens}, Max Retries=${effectiveMaxRetries}, Modelo=${MODEL_NAME}`);

    // --- LÓGICA DE TENTATIVAS COM RODÍZIO E RESILIÊNCIA ---
    let lastErrorDetails = null; // Para armazenar detalhes do último erro em caso de falha total

    for (let attempt = 0; attempt < effectiveMaxRetries; attempt++) {
        // LÓGICA DE RODÍZIO SEQUENCIAL
        const keyToUseIndex = currentKeyIndex % apiKeys.length;
        const groqApiKey = apiKeys[keyToUseIndex];
        console.log(`--- TENTATIVA ${attempt + 1}/${effectiveMaxRetries} ---`);
        console.log(`Selecionando chave de API. Índice: ${keyToUseIndex}`);

        // Incrementa o índice global para a próxima tentativa/chamada.
        currentKeyIndex++;

        const groq = new Groq({ apiKey: groqApiKey });

        try {
            console.log("Iniciando chamada à API Groq...");
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                console.warn(`Timeout de ${DEFAULT_TIMEOUT_MS}ms atingido para esta tentativa.`);
                controller.abort();
            }, DEFAULT_TIMEOUT_MS);

            const startTime = Date.now();
            const chatCompletion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: MODEL_NAME,
                max_tokens: effectiveMaxTokens,
            }, { signal: controller.signal });

            const endTime = Date.now();
            clearTimeout(timeoutId); // Limpa o timeout se a chamada for bem-sucedida

            const responseTimeMs = endTime - startTime;
            console.log(`✅ Chamada bem-sucedida com a chave de índice ${keyToUseIndex}. Tempo de resposta: ${responseTimeMs}ms.`);
            
            // Retorna a resposta com sucesso
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(chatCompletion),
            };

        } catch (error) {
            // TRATAMENTO DE ERRO DETALHADO E INTELIGENTE
            clearTimeout(timeoutId); // Garante que o timeout seja limpo em caso de erro
            const errorCode = error.code || error.status || 'UNKNOWN';
            const errorMessage = error.message || 'Erro desconhecido';
            
            console.error(`❌ Erro na tentativa ${attempt + 1} com a chave de índice ${keyToUseIndex}:`, errorCode, errorMessage);
            lastErrorDetails = { attempt: attempt + 1, keyIndex: keyToUseIndex, code: errorCode, message: errorMessage };

            // DECISÃO SOBRE RETRY BASEADA NO TIPO DE ERRO
            let shouldRetry = false;
            let backoffDelayMs = 0;

            if (errorCode === 'ABORT_ERR' || errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('aborted')) {
                console.warn("⚠️ Erro de timeout detectado. Marcar para retry.");
                shouldRetry = true;
                // Pequeno backoff para timeouts
                backoffDelayMs = BACKOFF_BASE_DELAY_MS; 
            } else if (errorCode === 429) {
                console.warn("⚠️ Erro 429 (Rate Limit) detectado. Marcar para retry com backoff.");
                shouldRetry = true;
                // Backoff exponencial para rate limits
                backoffDelayMs = BACKOFF_BASE_DELAY_MS * Math.pow(2, attempt); 
                console.log(`Calculado backoff de ${backoffDelayMs}ms antes da próxima tentativa.`);
            } else if (errorCode === 401) {
                 console.error("⛔ Erro 401 (Unauthorized) - Chave de API inválida. Não tentará novamente com esta chave.");
                 // Não tenta novamente com a mesma chave, mas pode tentar com outra se houver
                 shouldRetry = (effectiveMaxRetries > 1 && attempt < effectiveMaxRetries - 1); // Só não tenta novamente se for a última
                 backoffDelayMs = 0;
            } else {
                console.error("⛔ Erro inesperado da API. Não tentará novamente com esta chave.");
                // Erros genéricos (500, 503, etc.) podem ser temporários, então tenta a próxima chave
                shouldRetry = (effectiveMaxRetries > 1 && attempt < effectiveMaxRetries - 1);
                backoffDelayMs = BACKOFF_BASE_DELAY_MS / 2; // Pequeno delay antes de tentar outra chave
            }

            // Aplica o delay de backoff, se necessário, antes da próxima tentativa
            if (shouldRetry && backoffDelayMs > 0 && attempt < effectiveMaxRetries - 1) {
                console.log(`⏳ Aplicando backoff de ${backoffDelayMs}ms antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelayMs));
            }

            // Se for o último retry e ainda falhar, ou se for um erro terminal, não tenta mais
            if (!shouldRetry || attempt === effectiveMaxRetries - 1) {
                 console.error("🛑 Decisão de NÃO RETENTAR tomada. Encerrando tentativas.");
                 break; // Sai do loop de tentativas
            }
        }
    }

    // 6. RESPOSTA FINAL DE FALHA (INFORMÁTIVA E BLINDADA)
    console.error("--- TODAS AS TENTATIVAS FRACASSARAM ---");
    const finalErrorMsg = `A API da Groq falhou em responder após ${effectiveMaxRetries} tentativas. O serviço pode estar sobrecarregado ou uma chave pode estar inválida/excedida.`;
    console.error(finalErrorMsg);
    console.error("Detalhes do último erro:", lastErrorDetails);

    return {
        statusCode: 504, // Gateway Timeout - apropriado para proxy
        body: JSON.stringify({ 
            error: { 
                message: finalErrorMsg,
                last_error: lastErrorDetails // Inclui detalhes para depuração
            } 
        }),
    };
};
// =========================================================================
// >>>>> FIM DO ARQUIVO netlify/functions/groq.js <<<<<
// =========================================================================