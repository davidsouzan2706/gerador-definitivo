// Arquivo: netlify/functions/groq.js - VERSÃO 7.0: SELEÇÃO RANDÔMICA E STATELESS

const Groq = require('groq-sdk');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

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
  
  // ==========================================================
  // LÓGICA DE SELEÇÃO INTELIGENTE (RANDÔMICA E STATELESS)
  // ==========================================================
  // 1. Gera um índice aleatório que vai de 0 até (número de chaves - 1).
  const randomIndex = Math.floor(Math.random() * apiKeys.length);
  
  // 2. Pega a chave aleatória da vez.
  const groqApiKey = apiKeys[randomIndex];
  // ==========================================================
  
  console.log(`Usando a chave de índice randômico: ${randomIndex}`);
  
  const groq = new Groq({ apiKey: groqApiKey });
  
  try {
    const { prompt, maxTokens } = JSON.parse(event.body);

    if (!prompt) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt in request body' }) };
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-70b-8192',
      max_tokens: maxTokens || 2048,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatCompletion),
    };

  } catch (error) {
    console.error(`Erro com a chave de índice ${randomIndex}:`, error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: error.message } }),
    };
  }
};