/**
 * Modelos iniciais de cada organização. A migração 0003 grava os mesmos textos nas organizações
 * que já existiam; a clínica edita tudo depois em Cadastros.
 */

/** Prontuário da consulta [p.5], sem FC, FR, temperatura e TPC, que viraram campos estruturados. */
export const consultationRecordTemplate = `ANAMNESE
Queixa principal:
Ambiente:
Alimentação:
Vacinação:
Vermifugação:
Ectoparasitas:
Histórico reprodutivo:
História médica anterior:
Procedimentos realizados:

EXAME CLÍNICO
Olhos e mucosa ocular:
Cavidade oral:
Hidratação:
Pulso venoso jugular:
Pulso arterial:
Orelhas:
Linfonodos:
Pele e pelo:
Membros torácicos:
Tórax:
Membros pélvicos:
Abdome:
Urinário:
Genital:
Musculoesquelético:
Nervoso:

CONCLUSÕES
Suspeita diagnóstica:
Tratamento:
Exames solicitados:
Outras observações:`;

export const starterClinicalTemplates = [
  {
    kind: 'prescription' as const,
    name: 'Receita simples',
    body: `Uso oral

1. `,
  },
  {
    kind: 'document' as const,
    name: 'Atestado de saúde',
    body: `Atesto, para os devidos fins, que examinei nesta data o animal {{animal}}, {{especie}}, {{raca}}, {{sexo}}, {{idade}}, microchip {{microchip}}, sob responsabilidade de {{responsavel}} ({{documento_responsavel}}), e que ele não apresenta sinais clínicos de doença infectocontagiosa.

{{unidade}}, {{data}}.`,
  },
];
