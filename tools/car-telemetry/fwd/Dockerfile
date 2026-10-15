# python:3.13-slim, official image, pinned by its linux/arm64 manifest digest
FROM python:3.13-slim@sha256:cf97c3b79da1c706532c7042f851654d97d3b88c8ca6520acda9cf4479ea9b14
WORKDIR /app
COPY --chmod=0644 requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chmod=0644 fwd.py .
USER 65532:65532
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/fwd.py"]
