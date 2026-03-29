const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Generate MCQs from text using Claude API
async function generateMCQs(text, count = 15) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a quiz generator. From the following text, generate exactly ${count} high-yield multiple choice questions (MCQs). Focus on the MOST important concepts, key facts, and critical details.

Return ONLY valid JSON array with this exact format (no markdown, no backticks):
[
  {
    "question": "The question text?",
    "options": ["A) option1", "B) option2", "C) option3", "D) option4"],
    "correct": 0,
    "explanation": "Brief explanation why this is correct"
  }
]

Make questions challenging but fair. Each question must have exactly 4 options. The "correct" field is the zero-based index of the correct option.

TEXT:
${text.substring(0, 12000)}`
    }]
  });

  const content = response.content[0].text.trim();
  // Try to extract JSON from the response
  let jsonStr = content;
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  return JSON.parse(jsonStr);
}

// Upload and process file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    let text = '';

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(dataBuffer);
        text = pdfData.text;
      } else if (ext === '.txt' || ext === '.md') {
        text = fs.readFileSync(req.file.path, 'utf-8');
      } else {
        return res.status(400).json({ error: 'Unsupported file type. Use PDF or TXT.' });
      }
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
    } else if (req.body.text) {
      text = req.body.text;
    } else if (req.body.url) {
      // Fetch URL content
      const response = await fetch(req.body.url);
      text = await response.text();
      // Strip HTML tags for basic extraction
      text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
                 .replace(/<style[\s\S]*?<\/style>/gi, '')
                 .replace(/<[^>]+>/g, ' ')
                 .replace(/\s+/g, ' ')
                 .trim();
    }

    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'Not enough text content to generate questions. Please provide more content.' });
    }

    const questions = await generateMCQs(text);
    res.json({ success: true, questions, totalExtracted: text.length });
  } catch (err) {
    console.error('Error processing upload:', err);
    res.status(500).json({ error: 'Failed to process content: ' + err.message });
  }
});

// Process raw text
app.post('/api/text', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'Please provide at least 50 characters of text.' });
    }
    const questions = await generateMCQs(text);
    res.json({ success: true, questions });
  } catch (err) {
    console.error('Error generating questions:', err);
    res.status(500).json({ error: 'Failed to generate questions: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🏃 Quiz Runner server running at http://localhost:${PORT}`);
});
