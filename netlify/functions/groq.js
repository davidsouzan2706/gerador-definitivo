// Arquivo: netlify/functions/groq.js - VERSÃO 6.0: ROUND-ROBIN INTELIGENTE

const Groq = require('groq-sdk');

// Variável para guardar o último índice usado.
// Ela será resetada a cada "cold start" da função, mas o cache da Netlify nos ajudará.
let lastUsedIndex = -1;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method NotAllowed' };
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
  // LÓGICA DE SELEÇÃO INTELIGENTE (ROUND-ROBIN)
  // ==========================================================
  // 1. Lê o último índice do "cache" da Netlify ou usa o valor da memória.
  // A Netlify pode manter a função "aquecida", então a variável `lastUsedIndex` pode persistir.
  let currentIndex = parseInt(process.env.LAST_GROQ_KEY_INDEX, 10) || lastUsedIndex;

  // 2. Calcula o próximo índice na fila.
  // O operador '%' (módulo) garante que o índice volte a 0 quando chegar ao fim da lista.
  const nextIndex = (currentIndex + 1) % apiKeys.length;
  
  // 3. Pega a chave da vez.
  const groqApiKey = apiKeys[nextIndex];
  
  // 4. "Lembra" o índice que acabamos de usar para a próxima execução.
  // Atualiza a variável em memória E a variável de ambiente do processo.
  lastUsedIndex = nextIndex;
  process.env.LAST_GROQ_KEY_INDEX = nextIndex.toString();
  // ==========================================================
  
  console.log(`Usando a chave de índice: ${nextIndex}`); // Adiciona um log para podermos ver qual chave está sendo usada.
  
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
    console.error(`Erro com a chave de índice ${nextIndex}:`, error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: error.message } }),
    };
  }
};