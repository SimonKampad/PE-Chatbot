/**
 * server.js - FitBuddy AI Express Server
 * College Prompt Engineering Assignment No. 11: Design, Test & Break Your AI Assistant
 * 
 * Stack: Node.js, Express, @google/genai, dotenv, helmet, express-rate-limit
 */

const dns = require('node:dns');
try {
  // Ensure Node uses IPv4 first to avoid IPv6 connection resets with Google APIs on certain ISPs
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

// Resilient network wrapper: handles transient ISP connection resets (ECONNRESET/wsarecv)
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (...args) {
    let attempts = 0;
    while (attempts < 4) {
      try {
        attempts++;
        return await originalFetch.apply(this, args);
      } catch (err) {
        const isNetworkReset = err && (err.message?.includes('fetch failed') || err.code === 'ECONNRESET');
        if (attempts >= 4 || !isNetworkReset) throw err;
        await new Promise(r => setTimeout(r, 500 * attempts));
      }
    }
  };
}

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/genai');
const { SYSTEM_PROMPT, ASSIGNMENT_TEST_CASES } = require('./prompts');

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// --- Security Middleware ---

// 1. Helmet: Secure HTTP headers
// Note: We allow Google Fonts CDN and inline styles/scripts for custom gym theme
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// 2. Request body size limiter (defense against Denial-of-Service with large payloads)
app.use(express.json({ limit: '15kb' }));

// 3. Rate limiting: protect against spam and API quota exhaustion
const chatRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 60, // Limit each IP to 60 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP. Please wait a few moments before continuing your workout session.'
  }
});

// Serve frontend static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// --- Initialize Gemini AI Client ---
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  if (!apiKey || apiKey === 'your_actual_gemini_api_key_here') {
    return null;
  }

  return new GoogleGenAI({ apiKey });
}

// --- API Endpoints ---

/**
 * GET /api/health
 * Public health & configuration status (never exposes the secret key)
 */
app.get('/api/health', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
  const isKeyConfigured = Boolean(apiKey && apiKey !== 'your_actual_gemini_api_key_here');

  res.json({
    status: 'online',
    assistant: 'FitBuddy AI',
    model: GEMINI_MODEL,
    apiKeyConfigured: isKeyConfigured
  });
});

/**
 * GET /api/test-cases
 * Provides Assignment No. 11 test scenarios for the frontend Testing Drawer
 */
app.get('/api/test-cases', (req, res) => {
  res.json({
    testCases: ASSIGNMENT_TEST_CASES
  });
});

/**
 * POST /api/chat
 * Primary chat endpoint for communicating with FitBuddy AI
 */
app.post('/api/chat', chatRateLimiter, async (req, res) => {
  try {
    const { message, history } = req.body;

    // 1. Validation: Message must exist and be a non-empty string
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request: "message" is required and must be text.'
      });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
      return res.status(400).json({
        error: 'Message cannot be empty.'
      });
    }

    // 2. Validation: Message length cannot exceed 2,000 characters
    if (trimmedMessage.length > 2000) {
      return res.status(400).json({
        error: 'Message exceeds the maximum limit of 2,000 characters. Please shorten your question.'
      });
    }

    // 3. Verify Gemini API key configuration
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini API key is not configured. Please add your GEMINI_API_KEY in the .env file and restart the server.'
      });
    }

    // 4. Construct conversation payload with server-governed system prompt
    // We sanitize client-supplied history (max 8 turns) and format it for @google/genai
    const contents = [];

    if (Array.isArray(history)) {
      // Limit to the most recent 8 messages to prevent context exhaustion
      const recentHistory = history.slice(-8);

      for (const turn of recentHistory) {
        if (turn && typeof turn.text === 'string' && turn.text.trim().length > 0) {
          const role = (turn.role === 'assistant' || turn.role === 'model') ? 'model' : 'user';
          contents.push({
            role: role,
            parts: [{ text: turn.text.slice(0, 2000) }]
          });
        }
      }
    }

    // Append the current user message
    contents.push({
      role: 'user',
      parts: [{ text: trimmedMessage }]
    });

    // 5. Send request to Gemini API with server-side system instruction
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    });

    // 6. Extract generated reply text safely
    const replyText = response && response.text ? response.text.trim() : '';

    if (!replyText) {
      return res.status(502).json({
        error: "FitBuddy AI couldn't generate a response for that query. Please try rephrasing."
      });
    }

    // 7. Return reply to frontend
    return res.json({
      reply: replyText
    });

  } catch (error) {
    // Log safe server error without exposing secrets or API keys
    console.error('FitBuddy API Error:', error.message || 'Unknown error');

    // Friendly error messaging based on common API errors
    const errMsg = (error.message || '').toLowerCase();

    if (errMsg.includes('api_key_invalid') || errMsg.includes('api key not valid')) {
      return res.status(401).json({
        error: 'The configured Gemini API key is invalid. Please check your .env file.'
      });
    }

    if (errMsg.includes('quota') || errMsg.includes('resource_exhausted')) {
      return res.status(429).json({
        error: 'Gemini API rate limit or quota exceeded. Please wait a minute and try again.'
      });
    }

    return res.status(500).json({
      error: 'FitBuddy AI server encountered an issue processing your request. Please try again shortly.'
    });
  }
});

// Fallback route for single-page app
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🏋️ FitBuddy AI Server running at http://localhost:${PORT}`);
  console.log(`🔒 Security active: Helmet headers + Rate limiting`);
  console.log(`🤖 Target Gemini Model: ${GEMINI_MODEL}`);
  console.log(`====================================================`);
});
