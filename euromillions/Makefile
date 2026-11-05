# EuroMillions Quantum Analytics — commandes usuelles (Linux/macOS).
PY ?= python3
VENV = .venv
BIN = $(VENV)/bin

.PHONY: install api web test test-api test-web typecheck build demo docker-up docker-down

install:
	$(PY) -m venv $(VENV)
	$(BIN)/pip install --upgrade pip
	$(BIN)/pip install -r backend/requirements-dev.txt
	cd frontend && npm ci

api:
	cd backend && ../$(BIN)/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

test: test-api test-web typecheck

test-api:
	cd backend && ../$(BIN)/python -m pytest

test-web:
	cd frontend && npm test

typecheck:
	cd frontend && npx tsc -b --noEmit

build:
	cd frontend && npm run build

demo:
	$(BIN)/python backend/scripts/generate_demo_data.py

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down
