-- Validação da rota /pedidos no SQL Server real (somente leitura).
-- Trocar [MIX-AL] por [MIX-SE] para a outra UF.

DECLARE @dataInicio DATE = '2026-10-07';
DECLARE @dataFim    DATE = '2026-10-07';

-- 1. Quais status a função painelvendas descarta no período?
--    fora_do_painel > 0 em status '5' indica que a função usa outra data (ex.: DataNota_CabPed).
SELECT cp.Status_CabPed,
       COUNT(*) AS pedidos,
       SUM(CASE WHEN pv.id_cabped IS NULL THEN 1 ELSE 0 END) AS fora_do_painel
FROM [MIX-AL].dbo.CabPedidos cp
LEFT JOIN (SELECT DISTINCT Empresa_Par, id_cabped
           FROM [MIX-AL].dbo.painelvendas(@dataInicio, @dataFim)) pv
  ON pv.Empresa_Par = cp.Empresa_CabPed AND pv.id_cabped = cp.ID_CabPed
WHERE cp.Data_CabPed >= @dataInicio AND cp.Data_CabPed < DATEADD(DAY, 1, @dataFim)
GROUP BY cp.Status_CabPed
ORDER BY cp.Status_CabPed;

-- 2. Status dos pedidos que a função devolve (a deduplicação em memória da API descarta a versão CabPedidos desses pedidos).
SELECT DISTINCT cp.Status_CabPed, COUNT(DISTINCT pv.id_cabped) AS pedidos
FROM [MIX-AL].dbo.painelvendas(@dataInicio, @dataFim) pv
JOIN [MIX-AL].dbo.CabPedidos cp
  ON cp.Empresa_CabPed = pv.Empresa_Par AND cp.ID_CabPed = pv.id_cabped
GROUP BY cp.Status_CabPed;

-- 3. Qual coluna a função usa como "Hora"? Comparar com Inicio/Fim/Data para ajustar o COALESCE da consulta de pendentes.
SELECT TOP 20 pv.id_cabped, pv.Hora,
       CONVERT(varchar(8), cp.Inicio_CabPed, 108) AS inicio,
       CONVERT(varchar(8), cp.Fim_CabPed, 108)    AS fim,
       CONVERT(varchar(8), cp.Data_CabPed, 108)   AS data_hora
FROM [MIX-AL].dbo.painelvendas(@dataInicio, @dataFim) pv
JOIN [MIX-AL].dbo.CabPedidos cp
  ON cp.Empresa_CabPed = pv.Empresa_Par AND cp.ID_CabPed = pv.id_cabped
ORDER BY pv.id_cabped;

-- 4. Pré-pedidos / subpedidos / filial no período: decidir se devem entrar em /pedidos.
SELECT cp.Status_CabPed, cp.PrePedido_CabPed, cp.Filial_CabPed,
       CASE WHEN cp.SubPedido_CabPed IS NULL OR cp.SubPedido_CabPed = 0 THEN 0 ELSE 1 END AS tem_subpedido,
       COUNT(*) AS pedidos
FROM [MIX-AL].dbo.CabPedidos cp
WHERE cp.Data_CabPed >= @dataInicio AND cp.Data_CabPed < DATEADD(DAY, 1, @dataFim)
GROUP BY cp.Status_CabPed, cp.PrePedido_CabPed, cp.Filial_CabPed,
         CASE WHEN cp.SubPedido_CabPed IS NULL OR cp.SubPedido_CabPed = 0 THEN 0 ELSE 1 END
ORDER BY 1, 2, 3, 4;

-- 5. Consulta de CabPedidos exatamente como a API executa (src/services/pedidosQuery.js): todos os status. Medir tempo num dia cheio.
SELECT
    CONCAT('AL', '|', cp.Empresa_CabPed, '|', cp.ID_CabPed, '|',
           COALESCE(CAST(it.Sequencia_IPed AS varchar(20)), 'SEMITEM')) AS id_linha,
    CASE WHEN it.Sequencia_IPed IS NULL THEN 'FALLBACK' ELSE 'SEQ' END AS chave_tipo,
    it.Sequencia_IPed       AS sequencia_iped,

    ev.supervisor_eqp,
    f.Abrev_For             AS abrev_for,
    cp.ID_CabPed            AS id_cabped,
    pr.descricao_pro        AS descricao_pro,
    cp.Data_CabPed          AS [data],
    it.Preco_IPed           AS preco_iped,
    it.Quantidade_IPed      AS quantidade_Iped,
    it.Promocao_IPed        AS promocao_iped,
    cp.Operador_CabPed      AS operador,
    cp.Vendedor_CabPed      AS vendedor,
    ev.Empresa_Eqp          AS empresa_eqp,
    par.Abrev_Par           AS abrev_par,
    c.Nome_cli              AS nome_cli,
    c.CNPJ_cli              AS cnpj_cli,
    c.Grupo_Cli             AS grupo_cli,
    gc.Nome_GrupCom         AS nome_grupcom,
    cv.Id_Conv              AS id_conv,
    cv.Nome_Conv            AS nome_conv,
    pr.codbarra_pro         AS cod_barra_pro,
    d.Descricao_CProm       AS descricao_cprom,
    CASE cp.PedidoPor_CabPed
        WHEN 9 THEN
            CASE cp.Operador_CabPed
                WHEN 'SERVCON' THEN cp.Operador_CabPed
                WHEN 'NEXFAR' THEN cp.Operador_CabPed
                WHEN 'RESULT MOBILE' THEN cp.Operador_CabPed
                WHEN 'RESULT WEBVENDAS' THEN cp.Operador_CabPed
                WHEN 'E-commerce' THEN 'E-COMMERCE'
                ELSE 'EDI-VAN'
            END
        WHEN 0 THEN 'POR VENDEDOR'
        WHEN 1 THEN
            CASE cp.Operador_CabPed
                WHEN 'NEXFAR' THEN 'NEXFAR CALL CENTER'
                ELSE 'CALL CENTER'
            END
        WHEN 2 THEN 'POR CLIENTE'
        WHEN 3 THEN 'POR PROMOTOR'
        ELSE 'CALL-CENTER'
    END                     AS canal,
    v.nome_Vnd              AS nome_vendedor,
    vt.nome_Vnd             AS nome_televenda,
    'AL'                 AS UF,

    CAST(NULL AS float)     AS total_venda,
    CAST(NULL AS float)     AS tot_desco,
    CAST(NULL AS float)     AS desco_iped,
    CAST(NULL AS float)     AS imposto_iped,
    CAST(NULL AS float)     AS outros_iped,
    CAST(NULL AS float)     AS total_cmv,
    CAST(NULL AS float)     AS spread,

    it.Unidade_IPed         AS unidade_iped,
    it.Conversao_IPed       AS conversao_iped,
    it.Desconto_IPed        AS desconto_item,
    it.Oferta_IPed          AS oferta_iped,

    cp.Empresa_CabPed       AS empresa_par,
    it.Produto_IPed         AS produto_iped,
    f.ID_for                AS id_for,
    cp.Cliente_CabPed       AS id_cliente,
    cp.Operacao_CabPed      AS operacao,
    pr.tipo_pro             AS tipo_pro,
    CONVERT(varchar(8), COALESCE(cp.Fim_CabPed, cp.Inicio_CabPed, cp.Data_CabPed), 108) AS hora,
    cp.PedidoPor_CabPed     AS pedido_por,
    v.equipe_vnd            AS equipe,
    cp.Condicao_CabPed      AS condicao_cabped,
    cp.Status_CabPed        AS status_cabped,
    cp.Operacao_CabPed      AS operacao_cabped,
    cp.Nota_CabPed          AS nota_cabped,
    CONVERT(varchar(10), cp.Data_CabPed, 23) AS data_dia,

    cp.RejeitadoMotivo_CabPed AS rejeitado_motivo,
    cp.obsCancelamento_cabPed AS obs_cancelamento
FROM [MIX-AL].dbo.CabPedidos cp
LEFT JOIN [MIX-AL].dbo.ItensPedido it
    ON it.Empresa_Iped = cp.Empresa_CabPed AND it.Numero_IPed = cp.ID_CabPed
OUTER APPLY (
    SELECT TOP 1 descricao_pro, codbarra_pro, tipo_pro, fornec_pro
    FROM [MIX-AL].dbo.Produtos WHERE Id_Pro = it.Produto_IPed
) pr
OUTER APPLY (
    SELECT TOP 1 ID_for, Abrev_For
    FROM [MIX-AL].dbo.Fornecedor WHERE ID_for = pr.fornec_pro
) f
OUTER APPLY (
    SELECT TOP 1 nome_Vnd, equipe_vnd FROM [MIX-AL].dbo.Vendedores
    WHERE Id_Vnd = cp.Vendedor_CabPed AND Empresa_Vnd = cp.Empresa_CabPed
) v
OUTER APPLY (
    SELECT TOP 1 Empresa_Eqp, supervisor_eqp FROM [MIX-AL].dbo.EquipeVenda
    WHERE Empresa_Eqp = cp.Empresa_CabPed AND Id_Eqp = v.equipe_vnd
) ev
OUTER APPLY (
    SELECT TOP 1 Abrev_Par FROM [MIX-AL].dbo.Parametros
    WHERE Empresa_Par = cp.Empresa_CabPed
) par
OUTER APPLY (
    SELECT TOP 1 Nome_cli, CNPJ_cli, Convenio_cli, Grupo_Cli FROM [MIX-AL].dbo.Clientes
    WHERE Id_Cli = cp.Cliente_CabPed
) c
OUTER APPLY (
    SELECT TOP 1 Id_Conv, Nome_Conv FROM [MIX-AL].dbo.Convenio
    WHERE Id_Conv = c.Convenio_cli
) cv
OUTER APPLY (
    SELECT TOP 1 Nome_GrupCom FROM [MIX-AL].dbo.GrupoComercial
    WHERE Id_GrupCom = c.Grupo_Cli
) gc
OUTER APPLY (
    SELECT TOP 1 Descricao_CProm FROM [MIX-AL].dbo.CabPromocao
    WHERE ID_CProm = it.Promocao_IPed
) d
OUTER APPLY (
    SELECT TOP 1 nome_Vnd FROM [MIX-AL].dbo.Vendedores
    WHERE Id_Vnd = cp.Televenda_CabPed AND Empresa_Vnd = cp.Empresa_CabPed
) vt
WHERE cp.Data_CabPed >= @dataInicio
  AND cp.Data_CabPed <  DATEADD(DAY, 1, @dataFim);
