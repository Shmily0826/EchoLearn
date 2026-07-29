FROM python:3.12-slim

WORKDIR /app

# System deps yt-dlp may use for some formats (ffmpeg is optional for
# subtitle-only downloads but harmless to include).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV YTDLP_TIMEOUT=90
ENV PORT=8000

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
