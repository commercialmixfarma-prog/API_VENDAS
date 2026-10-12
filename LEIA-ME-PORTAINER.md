# API_GERAL 1.2.0 — Docker e Portainer

Pacote completo de código-fonte, não uma imagem Docker pronta. Sem .env real, credenciais, node_modules, PostgreSQL, cron ou scripts de escrita. Destinado a **Docker Standalone**. Se o endpoint do Portainer for Swarm, não implantar este YAML sem adaptação.

## 1. O que está pronto

- Dockerfile multi-stage Node 24 Alpine, dependências de produção via package-lock, usuário node não-root, healthcheck HTTP e encerramento gracioso.
- Acesso SQL com trustServerCertificate=true fixo conforme autorização do TI informada pelo responsável; criptografia habilitada. Não desativa TLS globalmente nem substitui HTTPS para acesso externo.
- Stack com variáveis explícitas (sem dependência de stack.env), reinício automático, volume de logs e porta inicialmente restrita ao host.
- Limite de 7 dias por consulta, 2 consultas HTTP SQL simultâneas por processo e 100 requisições/minuto por IP. Stack usa pool SQL máximo 2. Não escalar réplicas sem reavaliar limites globais.

## 2. Teste opcional de Docker no Windows

Requer Docker Desktop instalado e rodando com containers Linux. Pare npm run dev para liberar a porta 3000. Extraia em pasta NOVA e copie para ela seu .env local já validado (não distribuído neste ZIP); mantenha host al-srv-sql.mixfarma.lan e porta 1433 para esse ambiente, conforme teste realizado. Não use esse host automaticamente na VPS.

Na pasta contendo Dockerfile e package.json:

```powershell
docker version
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps api npm run test:connection
docker compose up -d
docker compose logs --tail=100 api
```

Repita health, login e consulta no Thunder Client em http://localhost:3000. DNS/rota corporativa podem funcionar no Windows e falhar no Docker Desktop; em tal caso validar rede com TI. Não desative firewall para contornar.

## 3. Construir a imagem na VPS

Rota recomendada: enviar a pasta API_GERAL por SFTP (por exemplo WinSCP), sem node_modules e sem .env local. Use uma pasta nova, sem sobrepor implantações antigas. No terminal SSH da VPS, entre na pasta recebida que contém Dockerfile e package.json.

```sh
docker version
docker build -t mix-corporativo-api:1.2.0 .
docker image inspect mix-corporativo-api:1.2.0 --format '{{.Os}}/{{.Architecture}}'
```

A construção deve ocorrer no MESMO Docker daemon/endpoint que o Portainer gerencia. Construir apenas no Windows não disponibiliza a imagem na VPS. Construindo na VPS evita-se transportar imagem de arquitetura errada. Não é necessário instalar Node ou npm no host.

Alternativa: construir/publicar em registry autorizado e usar a referência no API_IMAGE. Não incluída nesta entrega e não requer publicar código/imagem abertamente.

## 4. Testar SQL de dentro do container antes da stack

Na VPS, criar .env a partir de env.producao.example e preencher privadamente. O endereço informado para dentro da VPS é 10.4.0.1. A porta foi deixada vazia propositalmente: confirmar com TI a porta do SQL/túnel vista pela VPS. Não assumir 1433 (LAN) nem 6060 (acesso externo anterior).

Em .env usar aspas simples para SERVICE_CLIENT_SECRET (hash bcrypt) e JWT_SECRET; manter segredos fora de Git e do ZIP. Para senha SQL com caracteres especiais, use a sintaxe apropriada do dotenv/Compose. Não usar docker run --env-file com esse arquivo: o parser do Docker CLI não interpreta aspas como o Compose.

```sh
cp env.producao.example .env
chmod 600 .env
# Editar .env com seu editor, preencher os valores antes de continuar.
docker compose config --quiet
docker compose run --rm --no-deps api npm run test:connection
```

Esperado: conexão SQL e leitura EquipeVenda AL/SE OK. Este comando executa o container temporário usando a imagem já construída e não publica porta nem inicia servidor HTTP. Não rodar docker compose up na VPS se vai gerenciar a execução pelo Portainer, para não criar cópias paralelas.

Se falhar, validar acesso a 10.4.0.1 e porta real a partir do container. A rota/túnel da VPS deve permitir origem da rede Docker. Não adicionar network_mode: host ou extra_hosts sem conhecer a topologia. Não expor SQL na Internet para resolver roteamento.

## 5. Criar stack no Portainer

Escolher o endpoint Standalone da VPS. Em Images, confirmar mix-corporativo-api:1.2.0. Em Stacks > Add stack, nome sugerido mix-corporativo-api, Web editor: colar portainer.stack.yml.

Em Environment variables, cadastrar os valores. Ao inserir diretamente no painel **não colocar aspas delimitadoras**, mesmo nos hashes com $. As aspas sintáticas do YAML devem ser mantidas. Nunca colar segredos no YAML. Environment variables são visíveis aos administradores do Docker/Portainer; restringir acesso. Este pacote não usa Docker Secrets.

| Variável obrigatória | Preenchimento |
|---|---|
| SERVICE_CLIENT_ID | Identificador de cliente da API já configurado |
| SERVICE_CLIENT_SECRET | Hash bcrypt, não senha original nem senha SQL |
| JWT_SECRET | Segredo de assinatura, pelo menos 32 caracteres aleatórios |
| SQLSERVER_HOST | 10.4.0.1, conforme destino informado para VPS; validar rota |
| SQLSERVER_PORT | Porta confirmada pelo TI para o acesso a partir da VPS |
| SQLSERVER_USER | Usuário SQL autorizado, preferencialmente somente leitura |
| SQLSERVER_PASSWORD | Senha SQL atual, preenchida privadamente |

Demais defaults estão no YAML: API_IMAGE=mix-corporativo-api:1.2.0, SQLSERVER_DATABASE=master, bancos MIX-AL/MIX-SE, VENDAS_UFS=AL,SE. Confirmar nomes antes de implantar. SQLSERVER_TRUST_CERT não é utilizada. Criptografia SQL é fixada em true na stack. Não adicionar NODE_TLS_REJECT_UNAUTHORIZED=0.

Se usar a imagem construída localmente na VPS, não habilitar a opção de sempre baixar/re-puxar imagem de registry. Implantar a stack, depois conferir Containers > api > Logs/Health. Não criar segunda stack com o mesmo serviço e porta. Nenhuma instância antiga foi parada ou banco/volume excluído por este pacote.

## 6. Validar HTTP na VPS e pelo seu computador

Na VPS:

```sh
curl --fail http://127.0.0.1:3000/health
```

O healthcheck é liveness: HTTP saudável não comprova SQL disponível. Repetir login e consulta real após deploy.

Para usar Thunder Client do Windows sem publicar HTTP na Internet, abrir túnel SSH. Substituir USUARIO_SSH e IP_PUBLICO_DA_VPS pelos valores reais; se SSH usa outra porta, acrescentar -p PORTA_SSH.

```powershell
ssh -N -L 3001:127.0.0.1:3000 USUARIO_SSH@IP_PUBLICO_DA_VPS
```

Manter o terminal do túnel aberto. Thunder Client:

- GET http://localhost:3001/health
- POST http://localhost:3001/auth/login, JSON client_id e client_secret (senha original correspondente ao hash, não o hash)
- GET http://localhost:3001/vendas/por-uf/AL?dataInicio=2026-09-04&dataFim=2026-09-04, Auth Bearer com access_token; repetir SE depois.

Se a porta local 3001 estiver ocupada, escolher outra porta livre no lado esquerdo do túnel e nas URLs. Não compartilhar token ou resposta com dados de clientes.

## 7. Acesso do Base44 e HTTPS

O bind 127.0.0.1:3000 foi intencional. http://IP_PUBLICO:3000 NÃO estará aberto. Para produção, configurar domínio e proxy HTTPS existente na VPS e então URL/secrets no backend consumidor. Não enviar credenciais da API ao navegador.

Se o proxy roda no host, encaminhar para 127.0.0.1:3000. Se roda em outro container, usar rede Docker compartilhada e nome DNS do serviço, não localhost do container do proxy; ajustar stack conforme o proxy real. TRUST_PROXY_HOPS depende da quantidade de proxies confiáveis, não colocar 1 sem verificar topologia. Esse passo não foi automatizado porque domínio, proxy e rede existentes ainda não foram confirmados.

Sem HTTPS/proxy e validação real da VPS, considerar implantação somente homologação. O endereço do SQL não é o endereço público da API.

## 8. Escopo das validações da entrega

Testes automatizados e verificações estáticas acompanham validacao/. Testes usam banco simulado, sem SQL corporativo. O usuário confirmou consulta local real correta antes de pedir esta entrega, mas não informou total/duração/UF; não se inventaram métricas.

Não foi possível executar docker build aqui porque o ambiente de preparação não possui Docker. O ZIP NÃO contém imagem pronta, não foi instalado no Portainer e não inclui credenciais. Executar os passos na infraestrutura alvo antes de considerar concluído.
