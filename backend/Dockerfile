FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Stamped at build time so a deploy can tell what is actually serving, rather
# than trusting that `docker compose up --build` did anything.
ARG GIT_COMMIT=unknown
RUN echo "$GIT_COMMIT" > /app/COMMIT

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
