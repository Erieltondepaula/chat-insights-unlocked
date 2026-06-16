import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  solicitante_id: z.string().min(1),
  profissional_id: z.string().uuid(),
  procedimento_id: z.string().uuid(),
  convenio: z.string().min(1),
  unidade: z.string().min(1),
  idade_paciente: z.number().int().min(0).max(120),
  data_hora: z.string().datetime(),
  demanda_id: z.string().uuid(),
});

/**
 * Hard Constraints — executado pelo Agente Flow ANTES de confirmar agendamento.
 * Se qualquer regra falhar, retorna ok=false + mensagem padronizada de contorno.
 */
export const validateBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const [{ data: prof }, { data: proc }] = await Promise.all([
      supabase.from("profissionais_regras").select("*").eq("id", data.profissional_id).maybeSingle(),
      supabase.from("procedimentos").select("*").eq("id", data.procedimento_id).maybeSingle(),
    ]);

    const fail = async (motivo: string, mensagem: string) => {
      await supabase
        .from("demandas_auditoria")
        .update({ motivo_bloqueio: motivo })
        .eq("id", data.demanda_id);
      return { ok: false as const, motivo, mensagem_contorno: mensagem };
    };

    if (!prof || !prof.ativo)
      return fail("profissional_inativo", "No momento esse profissional não está disponível. Posso sugerir outro horário?");
    if (!proc || !proc.ativo)
      return fail("procedimento_invalido", "Esse procedimento não está disponível para agendamento online. Vou direcionar para um atendente.");
    const convenios = (prof.convenios as string[]) ?? [];
    if (!convenios.includes(data.convenio))
      return fail("convenio_nao_aceito", `O profissional não atende ${data.convenio}. Posso buscar outro especialista que aceite seu convênio?`);
    const unidades = (prof.unidades_ativas as string[]) ?? [];
    if (!unidades.includes(data.unidade))
      return fail("unidade_nao_ativa", "Esse profissional não atende nessa unidade. Quer ver as unidades disponíveis?");
    if (data.idade_paciente < prof.idade_min || data.idade_paciente > prof.idade_max)
      return fail("faixa_etaria", "Esse profissional não atende essa faixa etária. Posso indicar um colega adequado?");

    return {
      ok: true as const,
      exige_guia: proc.exige_guia,
      duracao_minutos: proc.duracao_minutos,
    };
  });
