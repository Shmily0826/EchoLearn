import asyncio
import tempfile
import unittest
from unittest.mock import patch

import main
from fastapi import HTTPException


class Upload:
    filename = "lesson.wav"
    content_type = "audio/wav"

    def __init__(self, blob=b"wav"):
        self.blob = blob

    async def read(self, _limit):
        return self.blob


class Request:
    def __init__(self, upload, key):
        self.upload = upload
        self.headers = {"X-Api-Key": key}

    async def form(self):
        return {"file": self.upload}


class GroqResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        import json
        return json.dumps(self.payload).encode()


class LocalAudioTests(unittest.TestCase):
    def setUp(self):
        self.groq_key = main.GROQ_API_KEY
        self.api_key = main.YTDLP_API_KEY
        main.GROQ_API_KEY = "test-groq"
        main.YTDLP_API_KEY = "test-vps"

    def tearDown(self):
        main.GROQ_API_KEY = self.groq_key
        main.YTDLP_API_KEY = self.api_key

    def test_upload_auth_and_size_validation(self):
        with self.assertRaisesRegex(HTTPException, "Unauthorized"):
            asyncio.run(main.audio_transcribe(Request(Upload(), "wrong")))
        with self.assertRaisesRegex(HTTPException, "25 MiB"):
            asyncio.run(main.audio_transcribe(Request(Upload(b"x" * (25 * 1024 * 1024 + 1)), "test-vps")))

    def test_upload_rejects_missing_timed_segments(self):
        with tempfile.NamedTemporaryFile(suffix=".wav") as audio:
            audio.write(b"wav")
            audio.flush()
            with patch.object(main.urllib.request, "urlopen", return_value=GroqResponse({"text": "hello", "segments": []})):
                with self.assertRaisesRegex(HTTPException, "no timed speech"):
                    main._groq_transcribe(audio.name, upload_name="lesson.wav", upload_content_type="audio/wav", require_timed_segments=True)

    def test_upload_returns_timed_transcript(self):
        payload = {"language": "en", "segments": [{"start": 1, "end": 2, "text": "hello"}]}
        for filename, content_type in (("lesson.wav", "audio/wav"), ("lesson.mp3", "audio/mp3"), ("lesson.m4a", "audio/x-m4a")):
            with self.subTest(filename=filename, content_type=content_type):
                upload = Upload()
                upload.filename = filename
                upload.content_type = content_type
                with patch.object(main, "_groq_transcribe", return_value={"lines": payload["segments"], "language": "en"}) as transcribe:
                    response = asyncio.run(main.audio_transcribe(Request(upload, "test-vps")))
                self.assertEqual(response.status_code, 200)
                transcribe.assert_called_once()
                self.assertTrue(transcribe.call_args.kwargs["require_timed_segments"])


if __name__ == "__main__":
    unittest.main()
