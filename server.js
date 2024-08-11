const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@deepgram/sdk');
const axios = require('axios');

const app = express();
const port = 5000;

app.use(bodyParser.json());
app.use(cors());

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceId = process.env.VOICE_ID;


const deepgramClient = new createClient(deepgramApiKey);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log(`Saving file to: ${uploadDir}`);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}.wav`);
  }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('audio_data'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }

    console.log('File uploaded:', req.file);

    const audioFilePath = req.file.path;

    console.log('Transcribing audio file...');

    const audioStream = fs.createReadStream(audioFilePath);

    const { result } = await deepgramClient.listen.prerecorded.transcribeFile(
      audioStream,
      {
        model: 'nova-2',
        punctuate: true,
      }
    );

    const transcript = result.results.channels[0].alternatives[0].transcript;
    console.log('Transcript:', transcript);

    const transcriptJson = { transcript, timestamp: new Date().toISOString() };
    fs.writeFileSync('transcript.json', JSON.stringify(transcriptJson, null, 2));
    console.log('Transcript saved to transcript.json');

    const prompt = transcript;

    const getAnswerFromOpenAI = async (prompt) => {
      const url = 'https://api.openai.com/v1/chat/completions';  

      try {
        const response = await axios.post(
          url,
          {
            model: 'gpt-4o-mini',  
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100,
            temperature: 0.7,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openAiApiKey}`,
            },
          }
        );

        const answer = response.data.choices[0].message.content.trim();
        return answer;
      } catch (error) {
        console.error('Error generating answer from OpenAI:', error.response ? error.response.data : error.message);
        return null;
      }
    };

    const answer = await getAnswerFromOpenAI(prompt);

    if (answer) {
      const answerData = {
        answer: answer,
        timestamp: new Date().toISOString(),
      };

      const answerFilePath = 'answers.json';
      fs.writeFileSync(answerFilePath, JSON.stringify(answerData, null, 2));
      console.log('Answer saved to answers.json');

      const convertToSpeech = async () => {
        try {
          const response = await axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            headers: {
              'Accept': 'audio/mpeg',
              'xi-api-key': elevenLabsApiKey,
              'Content-Type': 'application/json',
            },
            data: {
              text: answer,
              model_id: 'eleven_monolingual_v1',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.5,
              },
            },
            responseType: 'arraybuffer',
          });

          const audioBuffer = Buffer.from(response.data, 'binary');
          fs.writeFileSync('output.mp3', audioBuffer);

          console.log('Audio file created successfully');
          return audioBuffer;
        } catch (error) {
          console.error('Error converting text to speech:', error);
          throw error;
        }
      };

      const audioBuffer = await convertToSpeech();

      res.set("Content-Disposition", `attachment; filename="output.mp3"`);
      res.set("Content-Type", "audio/mpeg");
      res.send(audioBuffer);

    } else {
      res.status(500).send('Error generating answer from OpenAI');
    }
  } catch (error) {
    console.error('Error processing the audio:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
