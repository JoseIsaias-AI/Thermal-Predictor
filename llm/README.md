# Chatbot local do Thermal Predictor

Backend Python responsável pelo comportamento do chatbot e pela comunicação
com um modelo executado localmente pelo Ollama. Nesta primeira entrega, RAG,
dataset e preditor ainda aparecem como fontes indisponíveis: o assistente deve
informar a limitação em vez de fabricar uma resposta.

## Escopo desta entrega

Esta primeira atividade configura o `qwen3:4b` no Ollama e estabelece o
comportamento-base do chatbot. O modelo deve:

- responder diretamente a perguntas conceituais dentro do escopo;
- adaptar e simplificar a linguagem sem apagar limitações técnicas;
- solicitar uma ferramenta quando a resposta depender de uma fonte específica;
- declarar dados insuficientes quando a fonte ou um parâmetro estiver ausente;
- tratar resultados como triagem, nunca como certificação ou aprovação;
- não inventar previsões, métricas, fontes ou fatos internos do projeto.

As integrações com RAG, dataset e preditor não fazem parte desta atividade. Seus
nomes e suas regras já estão definidos para que sejam adicionados depois sem
alterar o contrato público de `/api/chat`.

## Organização

```text
llm/
├── src/thermal_chatbot/
│   ├── api.py              # endpoints HTTP
│   ├── chatbot.py          # decisão e falha segura
│   ├── prompts.py          # comportamento e escopo versionados
│   ├── schemas.py          # contratos validados
│   ├── settings.py         # configuração por ambiente
│   └── providers/
│       ├── base.py         # interface independente do provedor
│       └── ollama.py       # integração HTTP com Ollama local
└── tests/                  # testes sem depender de um modelo real
```

## Requisitos

- Python 3.11 ou superior;
- Ollama instalado e executando localmente;
- modelo `qwen3:4b` baixado, ou outro modelo definido em `OLLAMA_MODEL`.

O Ollama deve permanecer em `127.0.0.1:11434`. Não exponha sua API diretamente
ao frontend ou à rede, pois a API local não possui autenticação por padrão.

## Instalação

No diretório `g02/llm`, crie e ative um ambiente virtual:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
```

Copie a configuração de exemplo e baixe o modelo:

```powershell
Copy-Item .env.example .env
ollama pull qwen3:4b
```

## Execução

Com o Ollama aberto, inicie a API:

```powershell
uvicorn thermal_chatbot.api:app --reload --host 127.0.0.1 --port 8000
```

Verifique o estado:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

Envie uma mensagem:

```powershell
$body = @{ message = "Explique o que é margem térmica" } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/chat `
  -ContentType "application/json" `
  -Body $body
```

A documentação interativa fica em `http://127.0.0.1:8000/docs`.

## Decisões possíveis

A resposta contém uma destas ações:

- `answer`: resposta geral que não exige fonte específica do projeto;
- `use_tool`: reservado para uma fonte implementada e autorizada;
- `insufficient_data`: falta fonte, parâmetro ou evidência suficiente.

Mesmo que o modelo solicite uma ferramenta indisponível, `chatbot.py` bloqueia
a chamada e devolve `insufficient_data`. Essa validação em código evita que a
segurança dependa exclusivamente do system prompt.

## Testes

```powershell
pytest
```

Os testes usam provedores simulados e o transporte de teste do HTTPX; portanto,
não enviam conteúdo a um modelo e não precisam que o Ollama esteja executando.

## Critérios de aceite verificados

- a API envia mensagens ao Ollama e recebe respostas estruturadas;
- o system prompt define identidade, escopo, confidencialidade e decisão;
- respostas fora do contrato são recusadas;
- ferramentas indisponíveis falham de forma segura;
- fontes não fornecidas ao modelo não são repassadas ao usuário;
- o endpoint de saúde diferencia serviço pronto de configuração incompleta.
