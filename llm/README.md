# Chatbot local do Thermal Predictor

Backend Python responsável pelo comportamento do chatbot e pela comunicação
com modelos executados localmente pelo Ollama. As três fontes do projeto estão
conectadas: documentação (RAG), dataset de ensaios e preditor térmico. O
assistente não produz número: temperatura só entra na resposta se tiver vindo
de uma consulta ao dataset ou da execução dos modelos.

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
| `dataset_query` | conectada | `dataset_completo_com_flags_de_auditoria.csv` |
| `thermal_prediction` | conectada | sete modelos `.joblib` em `modelos/<algoritmo>/` |

O que não está conectado é bloqueado em código: mesmo que o modelo peça a
ferramenta, a resposta vira `insufficient_data`. Cada fonte é registrada só
quando seus arquivos existem — `GET /api/health` diz qual está pronta e por quê.

### `dataset_query` — o que já foi medido

Filtra as leituras de ensaio e resume por termopar: número de leituras, mínimo,
média, máximo, limite e quantas passaram do limite.

Argumentos, todos opcionais: `tc_name`, `key_area`, `run_id` e os seis fatores
de projeto (`run_case`, `blower_direction`, `housing`, `board_position`,
`deflector_hole`, `material_coil_support`).

Só entram linhas cuja `missing_class` é `observed`. Os valores imputados no
pré-processamento ficam de fora da estatística e são contados à parte — eles
não são medições e apresentá-los como tal ensinaria ao usuário um número que
nenhum ensaio produziu.

### `thermal_prediction` — o que o modelo prevê

Recebe uma configuração completa e devolve os 77 termopares previstos, cada um
classificado por RN-01 (acima do limite, banda de incerteza a menos de 10% de
margem, dentro do limite) ou como monitoramento, quando o ponto não tem limite
declarado (RN-03).

```json
{
  "run_case": "Broil C2", "blower_direction": "To Front",
  "housing": "Closed", "board_position": "Center",
  "deflector_hole": "Closed", "material_coil_support": "Aluminium",
  "losses": {"present": "declared", "config": "Config S", "order": "Front Order"}
}
```

A codificação das 13 colunas é a mesma do notebook de exportação, conferida
contra as colunas já codificadas do dataset nas rodadas. Duas recusas são
deliberadas:

- nível fora do vocabulário, que devolve a lista de níveis aceitos;
- `losses.present = "none"` fora de `run_case = "Pyro"`, porque "sem perda" e
  Pyro são a mesma coluna na codificação e a combinação não tem representação
  na base.

O conjunto **AC Blower Inlet** foi treinado sem validação cruzada (poucas
leituras reais). Suas previsões saem marcadas, sem MAE, e o prompt manda
declarar isso ao citar um ponto dele.

Para evitar interpretação pelo LLM, o frontend também pode enviar a comparação
em campos estruturados no mesmo `POST /api/chat`:

```json
{
  "message": "Compare as direções selecionadas",
  "configuration": {
    "run_case": "Broil C2",
    "housing": "Closed",
    "board_position": "Center",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
    "losses": {
      "present": "declared",
      "config": "Config M",
      "order": "Front Order"
    }
  },
  "comparison": {
    "factor": "blower_direction",
    "levels": ["To Front", "To Back"]
  }
}
```

O texto controlado também usa esse caminho rápido. Se houver ambiguidade, o
backend não tenta adivinhar: mantém o roteamento pelo Qwen ou informa quais
campos estão faltando.

### Cortesia também é respondida em código

"Oi, tudo bem?", "obrigado", "tchau", "qual é o seu nome?" e "o que você faz?"
não dependem de documentação, dataset nem previsão: a resposta é sempre a
mesma. O backend reconhece essas mensagens localmente e responde na hora — a
saudação devolve um cumprimento e pergunta qual é a dúvida; a pergunta de
identidade devolve o nome do agente, **Robertão**; "o que você faz" lista
apenas as fontes realmente conectadas nesta execução, com a ressalva de
triagem preliminar.

O reconhecimento é estreito de propósito: só dispara quando a mensagem inteira
é cortesia. Uma palavra fora do vocabulário de saudação já devolve a pergunta
ao fluxo normal, então "Oi, o que é Blower Direction?" continua indo para a
documentação em vez de virar um "olá" que ignora a pergunta. Comparação enviada
em campos estruturados nunca é tratada como cortesia.

### Os números não passam pelo modelo

`POST /api/chat` devolve, além do texto, o campo `data` com o resultado bruto
da ferramenta. `data` nunca passa pelo LLM. Nas respostas livres, `answer` é
redigido pelo modelo a partir desse contexto; nas comparações controladas,
`answer` também é montado diretamente pelo backend. Assim o modelo não pode
inverter o sinal do delta, alterar uma temperatura ou omitir que o resultado é
uma previsão. O frontend deve ler temperatura, margem e estado de `data` —
nunca extrair números do texto.

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
│   ├── rag/
│   │   ├── chunking.py     # Markdown -> trechos com caminho de títulos
│   │   ├── embeddings.py   # vetorização local via Ollama
│   │   ├── store.py        # pgvector e implementação em memória
│   │   ├── retrieval.py    # ferramenta documentation_search
│   │   └── ingest.py       # pipeline e CLI de indexação
│   └── triage/
│       ├── factors.py      # vocabulário dos fatores e codificação dos modelos
│       ├── catalog.py      # dataset auditado e catálogo de pontos
│       ├── dataset.py      # ferramenta dataset_query
│       ├── prediction.py   # ferramenta thermal_prediction
│       ├── text.py         # normalização compartilhada pelos reconhecedores
│       ├── intents.py      # comparação reconhecida sem LLM
│       └── smalltalk.py    # saudação e cortesia respondidas sem LLM
└── tests/                  # testes sem banco, sem modelo e sem rede
```

## Requisitos

- Python 3.11 ou superior;
- Ollama instalado e executando localmente;
- modelo `qwen3:4b` baixado, ou outro modelo definido em `OLLAMA_MODEL`;
- modelo `embeddinggemma` baixado, ou outro definido em `OLLAMA_EMBEDDING_MODEL`
  (precisa expor a capacidade `embedding`; o `qwen3:4b` não expõe);
- Docker, para a base vetorial local;
- `dataset_completo_com_flags_de_auditoria.csv` e o diretório `modelos/`, ambos
  gerados pelos notebooks e não versionados. Os caminhos ficam em
  `DATASET_PATH` e `MODELS_DIR`, relativos a `g02/llm`.

Os `.joblib` foram serializados com **scikit-learn 1.7.2**. Versões seguintes
mudaram os módulos internos e falham ao carregar (`No module named '_loss'`),
por isso a dependência está presa em `>=1.7,<1.8`. Reexportar os modelos com
outra versão exige atualizar esse limite.

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

Sem GPU o `qwen3:4b` roda em CPU, e a medição mostra onde o tempo vai:
processar o prompt custa cerca de 25 tokens/s, mas **gerar** custa cerca de
4 tokens/s. Ou seja: o que o modelo escreve domina a espera, e cada palavra
desnecessária é tempo real de quem perguntou.

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/ps | ConvertTo-Json -Depth 4
```

Se `size_vram` for `0`, a execução é em CPU.

### O que foi feito a partir dessa medição

- **Duas etapas com formatos diferentes.** A etapa de decisão usa um schema
  sem campo de texto, então o modelo não *consegue* redigir uma resposta que
  seria descartada ao executar a ferramenta. Antes ele escrevia cerca de 150
  tokens ali — quase 40 s de espera jogados fora. A etapa de redação usa um
  schema sem campos de ferramenta, pelo mesmo motivo.
- **Recusa decidida em código não gasta geração.** Ferramenta indisponível,
  configuração incompleta ou busca sem resultado respondem direto, sem pedir
  texto ao modelo.
- **Comparação controlada usa um caminho rápido.** Quando a mensagem contém
  exatamente um fator conhecido, dois níveis válidos e a configuração, o
  backend extrai o vocabulário localmente, executa os dois cenários e monta a
  resposta diretamente dos deltas. Perguntas ambíguas continuam no Qwen. No
  teste local, o mesmo pedido caiu de 269,13 s para 8,28 s na primeira chamada
  e 0,033 s com os modelos já carregados. RAG e explicações livres continuam
  usando a LLM.
- **Cortesia responde sem geração nenhuma.** Saudação, agradecimento,
  despedida, nome e "o que você faz" são reconhecidos por vocabulário e
  respondidos em código, em milissegundos e sem nenhuma chamada ao Ollama.
  Antes, dizer "oi" custava as duas etapas completas do fluxo.
- **`OLLAMA_KEEP_ALIVE`** mantém o modelo residente. Recarregá-lo do disco
  custava cerca de 25 s na primeira pergunta depois de um tempo parado.
- **Resposta curta por instrução.** A tabela completa vai para o cliente em
  `data`, então o texto não precisa repeti-la.
- **Histórico recortado** às últimas seis mensagens (4.000 caracteres). Além
  do custo, um histórico longo empurraria o prompt de sistema para fora da
  janela de contexto — e com ele as regras de escopo e confidencialidade.

### Se ainda estiver lento

- usar uma máquina com GPU é o que muda a ordem de grandeza;
- `RAG_TOP_K` menor reduz o contexto a processar;
- um modelo menor em `OLLAMA_MODEL` gera mais rápido, com perda de qualidade;
- `RAG_ALWAYS_RETRIEVE=false` economiza a busca de proteção, aceitando que o
  modelo decida sozinho quando consultar a documentação — foi justamente aí
  que ele inventou valores de fator.

`OLLAMA_TIMEOUT_SECONDS` vem em 300 s por causa desse cenário sem GPU.

## Testes

```powershell
pytest
```

Os testes usam provedores simulados, uma base vetorial em memória, um CSV
temporário e um estimador falso injetado no preditor; portanto, não enviam
conteúdo a um modelo e não precisam do Ollama, do banco, do dataset real nem
dos `.joblib` em disco.

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
  declarado quando um trecho não cabe inteiro;
- a consulta ao dataset devolve as leituras observadas do filtro pedido e
  mantém os valores imputados fora da estatística;
- a previsão entrega ao modelo o vetor codificado correto e devolve a
  temperatura que o estimador calculou, classificada por RN-01;
- configuração incompleta ou fora do vocabulário não vira previsão: o
  estimador nem chega a ser executado.
