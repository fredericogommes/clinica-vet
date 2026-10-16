import {
  breedSchema,
  catalogItemSchema,
  type CatalogItem,
  type CatalogItemInput,
  type CatalogKind,
} from '@clinica/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '../../design-system/layout';
import { api } from '../../lib/api';
import { CatalogList } from './catalog-list';
import { breedsQuery, catalogQuery } from './queries';

function useCatalogSave(kind: CatalogKind) {
  const queryClient = useQueryClient();
  return async (id: string | null, input: CatalogItemInput) => {
    const saved = id
      ? await api('PUT', `/catalogs/${kind}/${id}`, catalogItemSchema, input)
      : await api('POST', `/catalogs/${kind}`, catalogItemSchema, input);
    await queryClient.invalidateQueries({ queryKey: ['catalogs', kind] });
    return saved;
  };
}

export function SimpleCatalogPage({
  kind,
  title,
  description,
  noun,
  masculine = false,
  area = 'Cadastros',
}: {
  kind: Exclude<CatalogKind, 'species'>;
  area?: string;
  masculine?: boolean;
  title: string;
  description: string;
  noun: string;
}) {
  const items = useQuery(catalogQuery(kind));
  const save = useCatalogSave(kind);
  return (
    <>
      <PageHeader area={area} title={title} description={description} />
      <div className="max-w-2xl">
        <CatalogList
          title={title}
          noun={noun}
          masculine={masculine}
          items={items.data}
          isPending={items.isPending}
          error={items.error}
          onRetry={() => void items.refetch()}
          save={save}
        />
      </div>
    </>
  );
}

export function SpeciesPage() {
  const species = useQuery(catalogQuery('species'));
  const saveSpecies = useCatalogSave('species');
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const current = selected ?? species.data?.[0] ?? null;
  const breeds = useQuery({ ...breedsQuery(current?.id ?? ''), enabled: Boolean(current) });
  const queryClient = useQueryClient();

  const saveBreed = async (id: string | null, input: CatalogItemInput) => {
    if (!current) return;
    if (id) await api('PUT', `/catalogs/breeds/${id}`, breedSchema, input);
    else await api('POST', `/catalogs/species/${current.id}/breeds`, breedSchema, input);
    await queryClient.invalidateQueries({ queryKey: breedsQuery(current.id).queryKey });
  };

  return (
    <>
      <PageHeader
        area="Cadastros"
        title="Espécies e raças"
        description="A raça sempre pertence a uma espécie: no cadastro do animal, só aparecem as raças da espécie escolhida."
      />
      <div className="grid gap-5 md:grid-cols-2">
        <CatalogList
          title="Espécies"
          description="Selecione uma espécie para ver as raças."
          noun="espécie"
          items={species.data}
          isPending={species.isPending}
          error={species.error}
          onRetry={() => void species.refetch()}
          save={saveSpecies}
          selectedId={current?.id ?? null}
          onSelect={setSelected}
        />
        {current ? (
          <CatalogList
            title={`Raças · ${current.name}`}
            noun="raça"
            items={breeds.data}
            isPending={breeds.isPending}
            error={breeds.error}
            onRetry={() => void breeds.refetch()}
            save={saveBreed}
          />
        ) : null}
      </div>
    </>
  );
}
