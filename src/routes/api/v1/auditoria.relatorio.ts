import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/v1/auditoria/relatorio?from=ISO&to=ISO&status=pendente|resolvido
 * Header: Authorization: Bearer <JWT do usuário com papel 'auditor'>
 *
 * Retorno: dois blocos por demanda
 *  - bloco1_solicitacao: quem / quando / o_que_pediu
 *  - bloco2_resolucao:   quem (Agente Flow ou atendente humano) / quando / como
 */
export const Route = createFileRoute("/api/v1/auditoria/relatorio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!jwt) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userRes, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
        if (authErr || !userRes?.user) return new Response("Unauthorized", { status: 401 });

        const { data: isAuditor } = await supabaseAdmin.rpc("has_role", {
          _user_id: userRes.user.id,
          _role: "auditor",
        });
        const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
          _user_id: userRes.user.id,
          _role: "admin",
        });
        if (!isAuditor && !isAdmin) return new Response("Forbidden", { status: 403 });

        const url = new URL(request.url);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const status = url.searchParams.get("status");

        // Cliente publishable + bearer do auditor → RLS atua como o usuário
        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );

        let q = supabase
          .from("demandas_auditoria")
          .select(
            "id, solicitante_id, solicitante_nome, canal, mensagem_original, intencao_detectada, data_abertura, status, resolvido_por_id, resolvido_por_tipo, resolvido_por_nome, agendamento_id, data_fechamento, log_solucao, motivo_bloqueio",
          )
          .order("data_abertura", { ascending: false })
          .limit(1000);

        if (from) q = q.gte("data_abertura", from);
        if (to) q = q.lte("data_abertura", to);
        if (status) q = q.eq("status", status);

        const { data, error } = await q;
        if (error) return new Response(error.message, { status: 500 });

        const totais = {
          solicitadas: data.length,
          pendentes: data.filter((d) => d.status === "pendente").length,
          em_atendimento: data.filter((d) => d.status === "em_atendimento").length,
          resolvidas: data.filter((d) => d.status === "resolvido").length,
          canceladas: data.filter((d) => d.status === "cancelado").length,
        };

        const itens = data.map((d) => ({
          id: d.id,
          bloco1_solicitacao: {
            quem: { id: d.solicitante_id, nome: d.solicitante_nome, canal: d.canal },
            quando: d.data_abertura,
            o_que_pediu: { mensagem: d.mensagem_original, intencao: d.intencao_detectada },
          },
          bloco2_resolucao:
            d.status === "resolvido"
              ? {
                  quem: {
                    id: d.resolvido_por_id,
                    tipo: d.resolvido_por_tipo, // 'agente_flow' | 'atendente_humano'
                    nome: d.resolvido_por_nome,
                  },
                  quando: d.data_fechamento,
                  como: { log: d.log_solucao, agendamento_id: d.agendamento_id },
                }
              : { status: d.status, motivo_bloqueio: d.motivo_bloqueio },
        }));

        return Response.json(
          { totais, itens },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
