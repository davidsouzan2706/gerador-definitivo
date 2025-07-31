// Arquivo: netlify/functions/groq.js - VERSÃO 8.0: Rotação Sequencial com Retry

const Groq = require('groq-sdk');

// Variável para manter o índice da última chave usada.
// Fica fora do handler para persistir entre invocações "quentes" da função.
let currentKeyIndex = 0;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // --- Validação das Chaves de API (igual à versão anterior) ---
  if (!process.env.GROQ_API_KEYS) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'A variável de ambiente GROQ_API_KEYS não está configurada no Netlify.' } }),
    };
  }
  const apiKeys = process.env.GROQ_API_KEYS.split(',').map(key => key.trim()).filter(Boolean);
  if (apiKeys.length === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Nenhuma chave de API válida encontrada na variável GROQ_API_KEYS.' } }),
    };
  }

  // --- Lógica de Geração e Requisição com Retry ---
  const { prompt, maxTokens } = JSON.parse(event.body);
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt in request body' }) };
  }
  
  // Tenta fazer a requisição até 2 vezes com chaves diferentes
  const maxRetries = Math.min(apiKeys.length, 2); 

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // ==========================================================
    // LÓGICA DE ROTAÇÃO SEQUENCIAL
    // ==========================================================
    // 1. Usa o índice atual para pegar a chave.
    const keyToUseIndex = currentKeyIndex % apiKeys.length;
    const groqApiKey = apiKeys[keyToUseIndex];
    console.log(`Tentativa ${attempt + 1}/${maxRetries}. Usando chave de índice: ${keyToUseIndex}`);
    
    // 2. Incrementa o índice para a PRÓXIMA requisição.
    currentKeyIndex++; 
    // ==========================================================
    
    const groq = new Groq({ apiKey: groqApiKey });
    
    try {
      // Cria a requisição com um timeout configurável (ex: 15 segundos)
      // A AbortSignal é a forma moderna de cancelar uma requisição fetch.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama3-70b-8192',
        max_tokens: maxTokens || 2048,
      }, { signal: controller.signal }); // Passamos o sinal de abort para a SDK

      // Se a requisição foi bem-sucedida, limpamos o timeout e retornamos.
      clearTimeout(timeoutId);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatCompletion),
      };

    } catch (error) {
      console.error(`Erro na tentativa ${attempt + 1} com a chave de índice ${keyToUseIndex}:`, error.message);
      
      // Se o erro foi um timeout (AbortError) ou um erro de limite de requisições,
      // o loop continua para tentar a próxima chave.
      if (error.name === 'AbortError') {
        console.warn(`Timeout de 15s atingido. Tentando próxima chave...`);
      } else if (error.status === 429) {
        console.warn(`Limite da chave atingido. Tentando próxima chave...`);
      } else {
        // Se for outro tipo de erro (ex: chave inválida), retorna o erro imediatamente.
        return {
          statusCode: 500,
          body: JSON.stringify({ error: { message: `Erro inesperado na API: ${error.message}` } }),
        };
      }
    }
  }

  // Se o loop terminar sem sucesso, significa que todas as tentativas falharam.
  return {
    statusCode: 504,
    body: JSON.stringify({ 
      error: { message: `A API da Groq falhou em responder após ${maxRetries} tentativas com chaves diferentes. Tente novamente mais tarde.` } 
    }),
  };
};