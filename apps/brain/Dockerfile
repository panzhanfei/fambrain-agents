FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /uvx /bin/
WORKDIR /app
COPY . /app
RUN uv sync --frozen --no-dev --all-packages
EXPOSE 3011
ENV FAMBRAIN_HOST=0.0.0.0
CMD ["uv", "run", "--no-dev", "fambrain-api"]
