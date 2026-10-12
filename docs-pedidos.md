# Rota /pedidos (v1.2.0)

Nova rota, autenticada com o mesmo token de serviço (`scope vendas:read`). A rota `/vendas` **não foi alterada**: mesma consulta, mesmas 52 colunas, mesmo envelope. É ela que continua alimentando o site de campanhas.

## Problema que a rota resolve

`painelvendas` é uma função criptografada do ERP (definition NULL em sys.sql_modules) e o acesso ao SQL Server é somente leitura. Ela descarta pedidos rejeitados (R) e abandonados (A) e, conforme o dia, outros status. Então `/vendas` nunca mostra esses pedidos.

`/pedidos` devolve **todos os pedidos do período, em qualquer status**: as linhas de `/vendas` (origem `PAINEL`) mais todo pedido de `CabPedidos` + `ItensPedido` que a função não devolveu, seja qual for o status, inclusive `'5'` (origem `CABPED`).

## Como funciona

Por UF, duas consultas sequenciais dentro do mesmo slot de leitura:

1. A consulta de `/vendas` (sem mudança).
2. `CabPedidos` + `ItensPedido` do período, **sem filtro de status**.

Em memória, todo pedido (`UF|empresa_par|id_cabped`) que já veio na consulta 1 é descartado da consulta 2 (vale a versão PAINEL, que tem CMV, imposto, spread). O que sobra entra como CABPED. Resultado: nenhum pedido fica de fora e não há duplicidade, sem rodar a função duas vezes no SQL Server.

Um pedido com status `5` em origem `CABPED` significa "faturado, mas a função não o devolveu nesta data" (provavelmente porque ela usa outra data, ex.: data da nota). Ele aparece em `contagem.linhasCabPedFaturadas`; em outra data ele deve aparecer em `/vendas`.

## Endpoints

| Rota | Retorno |
|---|---|
| `GET /pedidos?dataInicio&dataFim` | todas as UFs: `{success,total,contagem:{linhasPainel,linhasCabPed,linhasCabPedFaturadas},data,periodo}` |
| `GET /pedidos/por-uf/:uf?dataInicio&dataFim` | uma UF, mesmo envelope + `uf` |
| `GET /pedidos/resumo?dataInicio&dataFim` | pedidos/linhas/valor por status e por situação, venda realizada, motivos de rejeição |
| `GET /pedidos/status` | dicionário de status e situações |

Filtros opcionais (allowlist, aplicados após a consulta): `status=R,A`, `situacao=PERDIDO`, `origem=CABPED`.

Limites iguais aos de `/vendas`: `API_MAX_RANGE_DAYS` (7), `API_MAX_CONCURRENT_READS` (2), rate limit por IP.

## Colunas

As 52 de `/vendas`, com os mesmos nomes e ordem, mais:

| Coluna | Significado |
|---|---|
| `rejeitado_motivo` | `CabPedidos.RejeitadoMotivo_CabPed` (NULL nas linhas PAINEL) |
| `obs_cancelamento` | `CabPedidos.obsCancelamento_cabPed` (NULL nas linhas PAINEL) |
| `origem` | `PAINEL` (função) ou `CABPED` (lido do cabeçalho) |
| `valor_pedido_bruto` | PAINEL: mesma regra de `/vendas/resumo` (devolução usa `total_venda`, venda usa preço × quantidade). CABPED: preço × quantidade × (1 − `desconto_item`/100), porque em `ItensPedido` o preço é bruto e `Desconto_IPed` é percentual (validado contra o painel) |
| `status_descricao` | texto do status |
| `situacao` | `FATURADO`, `EM_ANDAMENTO`, `PERDIDO`, `OUTRO` |

Dicionário de status (`Status_CabPed` é **nvarchar**; compare sempre com texto):

| status | descrição | situação |
|---|---|---|
| 0, 1 | Aguardando liberação | EM_ANDAMENTO |
| 2 | Aguardando OS | EM_ANDAMENTO |
| 3 | Separando | EM_ANDAMENTO |
| 4 | Aguardando NFe | EM_ANDAMENTO |
| 5 | Nota emitida | FATURADO |
| R | Rejeitado | PERDIDO |
| A | Abandonado | PERDIDO |

Qualquer outro código aparece como `Status X` / `OUTRO` para não esconder dado.

## Regras para quem consome

- **Venda realizada = `origem = 'PAINEL'`.** Linhas CABPED com status 5 não entram em `valorVendaRealizada` porque não têm os valores da função e aparecerão em `/vendas` na data que a função considera. Nunca somar `valor_pedido_bruto` de `PERDIDO` ou `EM_ANDAMENTO` como venda; é valor em risco / em andamento.
- Nas linhas `CABPED`, `total_venda`, `tot_desco`, `desco_iped`, `imposto_iped`, `outros_iped`, `total_cmv` e `spread` vêm NULL (não há faturamento).
- Nas linhas `CABPED`, `operacao` é o `Operacao_CabPed` do cabeçalho; `hora` é derivada de `Fim_CabPed`/`Inicio_CabPed`/`Data_CabPed` em `hh:mm:ss` (não existe coluna de hora no cabeçalho); `equipe`/`supervisor_eqp` vêm do cadastro atual do vendedor (`Vendedores.equipe_vnd`).
- Pedido sem item (abandonado antes de digitar) vem com `id_linha` terminando em `SEMITEM`, `chave_tipo = 'FALLBACK'` e valores NULL.
- Não existe coluna de data de alteração de status em `CabPedidos`. Um pedido de ontem que vira R/A hoje só aparece se a janela consultada incluir ontem. Para D-1 e consolidado, consultar com lookback de 2 a 3 dias e fazer upsert por `id_linha`.
- Consolidado de mês/ano **não** deve bater nesta rota (nem em `/vendas`) em tempo real: carregar D-1 para o banco intermediário e agregar lá.

## Validação no SQL real

Ver `validacao/pedidos-validacao.sql`: consulta de diagnóstico (quais status a função descarta), a consulta de pendentes pronta para rodar no SSMS e checagem de `hora`.
