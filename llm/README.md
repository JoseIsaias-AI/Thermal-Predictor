# Chatbot local do Thermal Predictor

Backend Python responsável pelo comportamento do chatbot e pela comunicação
com modelos executados localmente pelo Ollama. A busca na documentação do
projeto (RAG) já está conectada; dataset e preditor continuam indisponíveis, e
o assistente informa essa limitação em vez de fabricar uma resposta.

Tudo roda na máquina do time: geração, embeddings e base vetorial. O material
do parceiro é confidencial e não é enviado a nenhum serviço externo.

## Comportamento

O modelo deve:

- responder diretamente a perguntas conceituais dentro do escopo;
- adaptar e simplificar a linguagem sem apagar limitações técnicas;
- consultar a documentação autorizada quando a resposta depender dela;
- citar apenas trechos que foram de fato recuperados;
- declarar dados insuficientes quando a fonte ou um parâmetro estiver ausente;
- tratar resultados como triagem, nunca como certificação ou aprovação;
- não inventar previsões, métricas, fontes ou fatos internos do projeto.

## Como o RAG funciona

```text
Markdown -> trechos por seção -> embeddings (Ollama) -> pgvector
                                                          |
pergunta -> embedding -> busca por similaridade -> contexto + fontes -> LLM
```

Decisões que sustentam esse fluxo:

- **Corte por títulos.** Cada seção do glossário é autocontida, então o trecho
  acompanha seu caminho de títulos. É esse caminho que vira a citação exibida
  ao usuário — sem ele, a resposta citaria um arquivo inteiro.
- **Busca sempre executada.** Um modelo de 4B responde de cabeça sobre termos
  do projeto: perguntado sobre `Blower Direction`, chegou a afirmar que os
  valores eram "Forward/Reverse", quando o glossário diz `To Front`/`To Back`.
  Por isso a documentação é consultada mesmo quando o modelo não pede a
  ferramenta (`RAG_ALWAYS_RETRIEVE`). Quando nada relevante é encontrado, a
  resposta direta continua valendo — perguntas fora do corpus não são bloqueadas.
- **Fonte verificada em código.** Só é citada a fonte que foi entregue ao
  modelo naquela resposta; qualquer outra citação é descartada.
- **Contexto é dado, não instrução.** O bloco recuperado é delimitado e o
  prompt manda ignorar comandos que apareçam dentro dele.

## Fontes conectadas

| Ferramenta | Estado | Fonte |
|---|---|---|
| `documentation_search` | conectada | documentos Markdown em `docs/`, indexados no pgvector |
| `dataset_query` | indisponível | — |
| `thermal_prediction` | indisponível | — |

O que não está conectado é bloqueado em código: mesmo que o modelo peça a
ferramenta, a resposta vira `insufficient_data`.

## Organização

```text
llm/
├── docker-compose.yml      # base vetorial local (pgvector, porta 5435)
├── docs/                   # corpus autorizado, em Markdown com front matter
├── src/thermal_chatbot/
│   ├── api.py              # endpoints HTTP e registro de ferramentas
│   ├── chatbot.py          # decisão, busca, fundamentação e falha segura
│   ├── prompts.py          # comportamento e escopo versionados
│   ├── schemas.py          # contratos validados
│   ├── settings.py         # configuração por ambiente
│   ├── tools.py            # contrato das fontes executáveis
│   ├── providers/
│   │   ├── base.py         # interface independente do provedor
│   │   └── ollama.py       # integração HTTP com Ollama local
│   └── rag/
│       ├── chunking.py     # Markdown -> trechos com caminho de títulos
│       ├── embeddings.py   # vetorização local via Ollama
│       ├── store.py        # pgvector e implementação em memória
│       ├── retrieval.py    # ferramenta documentation_search
│       └── ingest.py       # pipeline e CLI de indexação
└── tests/                  # testes sem banco, sem modelo e sem rede
```

## Requisitos

- Python 3.11 ou superior;
- Ollama instalado e executando localmente;
- modelo `qwen3:4b` baixado, ou outro modelo definido em `OLLAMA_MODEL`;
- modelo `embeddinggemma` baixado, ou outro definido em `OLLAMA_EMBEDDING_MODEL`
  (precisa expor a capacidade `embedding`; o `qwen3:4b` não expõe);
- Docker, para a base vetorial local.

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

Copie a configuração de exemplo e baixe os modelos:

```powershell
Copy-Item .env.example .env
ollama pull qwen3:4b
ollama pull embeddinggemma
```

Suba a base vetorial e indexe o corpus:

```powershell
docker compose up -d rag-db
python -m thermal_chatbot.rag.ingest
```

A ingestão substitui todos os trechos de cada arquivo indexado, então pode ser
executada de novo sempre que um documento mudar. Para indexar um arquivo
específico, passe o caminho: `python -m thermal_chatbot.rag.ingest docs/x.md`.

### O corpus

`docs/` **não é versionado**: o conteúdo vem de material do parceiro,
classificado como confidencial. Depois de clonar o repositório, crie o
diretório e coloque nele os Markdown autorizados antes de indexar — sem isso a
ingestão não encontra nada e `documentation_search` fica indisponível.

Os arquivos são Markdown com front matter. Estes campos viram metadados dos
trechos e aparecem no contexto entregue ao modelo:

```yaml
---
titulo: "Glossário do projeto"
fonte_primaria: "glossario.pdf"
fonte_url: "https://..."
confidencialidade: "Confidencial"
---
```

Sem `confidencialidade`, o trecho é indexado como `não classificado`.

## Execução

Com o Ollama aberto, inicie a API:

```powershell
uvicorn thermal_chatbot.api:app --reload --host 127.0.0.1 --port 8000
```

Verifique o estado. A resposta traz o provedor e cada fonte conectada, com o
número de trechos indexados:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health | ConvertTo-Json -Depth 4
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

- `answer`: resposta fundamentada no contexto recuperado ou em conceito geral
  dentro do escopo;
- `insufficient_data`: falta fonte, parâmetro ou evidência suficiente.

`use_tool` é uma decisão interna do modelo; o cliente nunca a recebe, porque a
ferramenta é executada antes de a resposta ser montada.

Mesmo que o modelo solicite uma ferramenta indisponível, `chatbot.py` bloqueia
a chamada e devolve `insufficient_data`. Essa validação em código evita que a
segurança dependa exclusivamente do system prompt.

## Desempenho

Sem GPU, o `qwen3:4b` roda em CPU e uma resposta fundamentada leva de 3 a 5
minutos, porque envolve duas chamadas ao modelo (decisão e resposta com
contexto). Verifique onde o modelo está carregado com:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/ps | ConvertTo-Json -Depth 4
```

Se `size_vram` for `0`, a execução é em CPU. Formas de reduzir o tempo:

- usar uma máquina com GPU — é o que muda a ordem de grandeza;
- reduzir `RAG_TOP_K` (menos contexto, menos tokens para processar);
- desligar `RAG_ALWAYS_RETRIEVE` para economizar uma chamada, aceitando que o
  modelo passa a decidir sozinho quando consultar a documentação — foi
  justamente aí que ele inventou valores de fator.

`OLLAMA_TIMEOUT_SECONDS` já vem em 300 s por causa disso.

## Testes

```powershell
pytest
```

Os testes usam provedores simulados, uma base vetorial em memória e o
transporte de teste do HTTPX; portanto, não enviam conteúdo a um modelo e não
precisam do Ollama nem do banco em execução.

## Critérios de aceite verificados

- a API envia mensagens ao Ollama e recebe respostas estruturadas;
- o system prompt define identidade, escopo, confidencialidade e decisão;
- respostas fora do contrato são recusadas;
- ferramentas indisponíveis falham de forma segura;
- fontes não fornecidas ao modelo não são repassadas ao usuário;
- o endpoint de saúde diferencia serviço pronto de configuração incompleta;
- o Markdown é fragmentado por seção, com citação que aponta documento e seção;
- a busca devolve trechos acima do limiar e nada abaixo dele;
- pergunta sem trecho correspondente vira `insufficient_data`, sem estimativa;
- o contexto recuperado respeita um orçamento de caracteres, com corte
  declarado quando um trecho não cabe inteiro.
