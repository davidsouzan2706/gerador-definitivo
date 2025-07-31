// Arquivo: netlify/functions/groq.js - VERSÃO 10.0 (FINAL): Configuração de Timeout Alinhada

const Groq = require('groq-sdk');

let currentKeyIndex = 0;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!process.env.GROQ_API_KEYS) {
    return { statusCode: 500, body: JSON.stringify({ error: { message: 'Variável de ambiente GROQ_API_KEYS não configurada.' } }) };
  }
  const apiKeys = process.env.GROQ_API_KEYS.split(',').map(key => key.trim()).filter(Boolean);
  if (apiKeys.length === 0) {
    return { statusCode: 500, body: JSON.stringify({ error: { message: 'Nenhuma chave de API válida encontrada.' } }) };
  }

  const { prompt, maxTokens } = JSON.parse(event.body);
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt in request body' }) };
  }
  
  const maxRetries = Math.min(apiKeys.length, 2); 

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const keyToUseIndex = currentKeyIndex % apiKeys.length;
    const groqApiKey = apiKeys[keyToUseIndex];
    console.log(`Tentativa ${attempt + 1}/${maxRetries}. Usando chave de índice: ${keyToUseIndex}`);
    
    currentKeyIndex++; 
    
    const groq = new Groq({ apiKey: groqApiKey });
    
    try {
      const controller = new AbortController();
      // Ajustamos nosso timeout interno para 15s. É tempo suficiente para a IA
      // e nos dá margem para uma segunda tentativa dentro do limite de 26s da Netlify.
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama3-70b-8192',
        max_tokens: maxTokens || 2048,
      }, { signal: controller.signal });

      clearTimeout(timeoutId);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatCompletion),
      };

    } catch (error) {
      console.error(`Erro na tentativa ${attempt + 1} com a chave de índice ${keyToUseIndex}:`, error.message);
      
      if (error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('aborted')) || (error.message && error.message.toLowerCase().includes('timed out'))) {
        console.warn(`Timeout de 15s atingido. Tentando próxima chave...`);
      } else if (error.status === 429) {
        console.warn(`Limite da chave atingido. Tentando próxima chave...`);
      } else {
        return { statusCode: 500, body: JSON.stringify({ error: { message: `Erro inesperado na API: ${error.message}` } }) };
      }
    }
  }

  return {
    statusCode: 504,
    body: JSON.stringify({ 
      error: { message: `A API da Groq falhou em responder após ${maxRetries} tentativas. O serviço pode estar sobrecarregado. Tente novamente.` } 
    }),
  };
};