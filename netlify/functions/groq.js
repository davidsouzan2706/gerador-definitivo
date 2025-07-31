// Arquivo: netlify/functions/groq.js - VERSÃO 9.0: Timeout Estendido e Retry Inteligente

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
      // ==========================================================
      // >>>>> MUDANÇA 1: AUMENTANDO O TIMEOUT PARA 28 SEGUNDOS <<<<<
      // ==========================================================
      const timeoutId = setTimeout(() => controller.abort(), 28000); // Aumentado de 15s para 28s

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
      
      // ==========================================================
      // >>>>> MUDANÇA 2: LÓGICA DE DETECÇÃO DE ERRO MELHORADA <<<<<
      // ==========================================================
      // Agora verificamos o nome do erro OU se a mensagem contém "aborted" ou "timed out".
      if (error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('aborted')) || (error.message && error.message.toLowerCase().includes('timed out'))) {
        console.warn(`Timeout atingido. Tentando próxima chave...`);
        // O loop continuará para a próxima tentativa
      } else if (error.status === 429) {
        console.warn(`Limite da chave atingido. Tentando próxima chave...`);
        // O loop continuará para a próxima tentativa
      } else {
        // Para qualquer outro erro, falha imediatamente.
        return {
          statusCode: 500,
          body: JSON.stringify({ error: { message: `Erro inesperado na API: ${error.message}` } }),
        };
      }
    }
  }

  // Se todas as tentativas falharem, retorna um erro final claro.
  return {
    statusCode: 504,
    body: JSON.stringify({ 
      error: { message: `A API da Groq falhou em responder após ${maxRetries} tentativas. O serviço pode estar sobrecarregado ou o prompt é muito complexo. Tente novamente mais tarde.` } 
    }),
  };
};