// Arquivo: netlify/functions/groq.js - VERSÃO 11.0 (COMPLETA): Modelo Rápido e Rodízio Sequencial

const Groq = require('groq-sdk');

// Variável para manter o índice da última chave usada.
// Fica fora do handler para persistir entre invocações "quentes" da função.
let currentKeyIndex = 0;

exports.handler = async (event) => {
  // 1. Validação do Método HTTP
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 2. Validação da Existência da Variável de Ambiente
  if (!process.env.GROQ_API_KEYS) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'A variável de ambiente GROQ_API_KEYS não está configurada no Netlify.' } }),
    };
  }

  // 3. Processamento das Chaves de API
  const apiKeys = process.env.GROQ_API_KEYS.split(',').map(key => key.trim()).filter(Boolean);
  if (apiKeys.length === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Nenhuma chave de API válida encontrada na variável GROQ_API_KEYS.' } }),
    };
  }

  // 4. Validação do Corpo da Requisição
  const { prompt, maxTokens } = JSON.parse(event.body);
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt in request body' }) };
  }
  
  // 5. Lógica de Tentativas (Retry)
  // Tenta fazer a requisição até 2 vezes com chaves diferentes.
  // Se você tiver apenas 1 chave, tentará apenas 1 vez.
  const maxRetries = Math.min(apiKeys.length, 2); 

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // LÓGICA DE RODÍZIO SEQUENCIAL INTELIGENTE
    // Usa o índice atual para pegar a chave e já prepara o próximo índice.
    const keyToUseIndex = currentKeyIndex % apiKeys.length;
    const groqApiKey = apiKeys[keyToUseIndex];
    console.log(`Tentativa ${attempt + 1}/${maxRetries}. Usando chave de índice: ${keyToUseIndex}`);
    
    // Incrementa o índice global para a próxima vez que a função for chamada.
    currentKeyIndex++; 
    
    const groq = new Groq({ apiKey: groqApiKey });
    
    try {
      const controller = new AbortController();
      // Timeout interno de 15 segundos para cada tentativa.
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        // MUDANÇA ESTRATÉGICA PARA O MODELO MAIS RÁPIDO
        model: 'llama3-8b-8192', 
        max_tokens: maxTokens || 2048,
      }, { signal: controller.signal });

      // Se a requisição foi bem-sucedida, limpa o timeout e retorna a resposta.
      clearTimeout(timeoutId);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatCompletion),
      };

    } catch (error) {
      // TRATAMENTO DE ERRO INTELIGENTE
      console.error(`Erro na tentativa ${attempt + 1} com a chave de índice ${keyToUseIndex}:`, error.message);
      
      // Se for um erro de timeout ou limite de requisições, tenta a próxima chave.
      if (error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('aborted')) || (error.message && error.message.toLowerCase().includes('timed out'))) {
        console.warn(`Timeout de 15s atingido. Tentando próxima chave...`);
      } else if (error.status === 429) {
        console.warn(`Limite da chave atingido. Tentando próxima chave...`);
      } else {
        // Se for outro tipo de erro (ex: chave inválida), falha imediatamente.
        return { statusCode: 500, body: JSON.stringify({ error: { message: `Erro inesperado na API: ${error.message}` } }) };
      }
    }
  }

  // 6. Resposta Final de Erro (se todas as tentativas falharem)
  // Se o loop terminar sem sucesso, retorna um erro 504.
  return {
    statusCode: 504,
    body: JSON.stringify({ 
      error: { message: `A API da Groq falhou em responder após ${maxRetries} tentativas. O serviço pode estar sobrecarregado. Tente novamente.` } 
    }),
  };
};