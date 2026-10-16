import type { ClientInput, PatientInput } from '@clinica/contracts';

/** CPF e CNPJ com dígitos verificadores válidos, usados só em testes. */
export const VALID_CPF = '529.982.247-25';
export const VALID_CNPJ = '11.222.333/0001-81';

export const emptyAddress = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};

export function clientInput(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    personType: 'individual',
    name: 'Carla Mendes',
    nationality: '',
    sex: null,
    cpf: '',
    cnpj: '',
    rg: '',
    birthDate: '',
    originId: null,
    profession: '',
    municipalRegistration: '',
    notes: '',
    contacts: [{ kind: 'mobile', value: '(11) 98765-4321', isWhatsapp: true }],
    address: emptyAddress,
    ...overrides,
  };
}

export function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    name: 'Thor',
    status: 'alive',
    deceasedOn: '',
    sex: 'male',
    sterilized: null,
    birthDate: '',
    speciesId: null,
    breedId: null,
    coatId: null,
    microchip: '',
    hasPedigree: false,
    pedigreeNumber: '',
    markings: [],
    ...overrides,
  };
}
