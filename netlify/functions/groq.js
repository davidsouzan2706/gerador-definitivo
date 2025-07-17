// Arquivo: netlify/functions/groq.js - VERSÃO 5.1: SDK OFICIAL + CHAVES RANDÔMICAS

// Importa o SDK oficial da Groq.
const Groq = require('groq-sdk');

// Define a função handler no formato moderno da Netlify.
exports.handler = async (event) => {
  // 1. Permite apenas requisições do tipo POST.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 2. Verifica se a variável de ambiente com as chaves existe.
  if (!process.env.GROQ_API_KEYS) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'A variável de ambiente GROQ_API_KEYS não está configurada no Netlify.' } }),
    };
  }

  // 3. Pega a string de chaves, separa por vírgula e limpa valores vazios.
  const apiKeys = process.env.GROQ_API_KEYS.split(',').filter(Boolean);

  // Validação: Garante que há pelo menos uma chave válida.
  if (apiKeys.length === 0) {
    return {
        statusCode: 500,
        body: JSON.stringify({ error: { message: 'Nenhuma chave de API válida encontrada na variável GROQ_API_KEYS.' } }),
    };
  }
  
  // 4. ESCOLHE UMA CHAVE RANDÔMICA DA LISTA
  const randomIndex = Math.floor(Math.random() * apiKeys.length);
  const groqApiKey = apiKeys[randomIndex];
  
  // 5. Inicializa o cliente da Groq com a chave SORTEADA.
  const groq = new Groq({ apiKey: groqApiKey });
  
  try {
    // 6. Pega o prompt e maxTokens do corpo da requisição.
    const { prompt, maxTokens } = JSON.parse(event.body);

    if (!prompt) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt in request body' }) };
    }

    // 7. Faz a chamada para a API Groq.
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-70b-8192',
      max_tokens: maxTokens || 2048,
    });

    // 8. Retorna a resposta com sucesso.
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatCompletion),
    };

  } catch (error) {
    console.error("Groq Function Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: error.message } }),
    };
  }
};