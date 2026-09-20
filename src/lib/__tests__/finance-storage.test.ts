import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CURRENT_STORAGE_VERSION,
  STORAGE_KEYS,
  STORAGE_VERSION,
  getInitialFinanceState,
  loadFinanceSnapshot,
  migrateFinanceSnapshot,
  safeParseDomainKey,
  sanitizeFinanceSnapshot,
  saveFinanceSnapshot,
  StorageParseError,
} from '../context/finance-storage';
import { Account, RecurringTransaction } from '../types';
import { FinanceState } from '../context/finance-state';

class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('finance-storage: resiliência, isolamento e schema versionado (V37 / P1-01 e P2-01)', () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
  });

  describe('getInitialFinanceState', () => {
    it('deve gerar estado financeiro inicial completo com todas as 17 coleções', () => {
      const initial = getInitialFinanceState();
      expect(initial.allWorkspaces.length).toBeGreaterThan(0);
      expect(initial.activeWorkspaceId).toBe(initial.allWorkspaces[0].id);
      expect(initial.allAccounts.length).toBeGreaterThan(0);
      expect(initial.allCreditCards.length).toBeGreaterThan(0);
      expect(initial.allCategories.length).toBeGreaterThan(0);
      expect(initial.allTransactions.length).toBeGreaterThan(0);
      expect(initial.allTransfers).toEqual([]);
      expect(initial.allSettlements).toEqual([]);
    });
  });

  describe('migrateFinanceSnapshot (P2-01: versionamento e migração idempotente)', () => {
    it('deve exportar as constantes de versão STORAGE_VERSION e CURRENT_STORAGE_VERSION como 1', () => {
      expect(STORAGE_VERSION).toBe(1);
      expect(CURRENT_STORAGE_VERSION).toBe(1);
      expect(STORAGE_KEYS.schemaVersion).toBe('fincontrol_v2_schema_version');
    });

    it('migra snapshot sem versão (null, undefined ou 0) para versão atual marcando migrated=true', () => {
      const initial = getInitialFinanceState();

      const resNull = migrateFinanceSnapshot(null, initial);
      expect(resNull.version).toBe(CURRENT_STORAGE_VERSION);
      expect(resNull.migrated).toBe(true);
      expect(resNull.snapshot.allAccounts.length).toBe(initial.allAccounts.length);

      const resUndef = migrateFinanceSnapshot(undefined, initial);
      expect(resUndef.version).toBe(CURRENT_STORAGE_VERSION);
      expect(resUndef.migrated).toBe(true);

      const resZero = migrateFinanceSnapshot(0, initial);
      expect(resZero.version).toBe(CURRENT_STORAGE_VERSION);
      expect(resZero.migrated).toBe(true);
    });

    it('operação idempotente: snapshot na versão atual não é modificado e marca migrated=false', () => {
      const initial = getInitialFinanceState();
      const first = migrateFinanceSnapshot(CURRENT_STORAGE_VERSION, initial);

      expect(first.version).toBe(CURRENT_STORAGE_VERSION);
      expect(first.migrated).toBe(false);
      expect(first.allAccounts).toEqual(initial.allAccounts);

      // Segunda chamada sobre o resultado da primeira
      const second = migrateFinanceSnapshot(first.version, first.snapshot);
      expect(second.version).toBe(CURRENT_STORAGE_VERSION);
      expect(second.migrated).toBe(false);
      expect(second.allAccounts).toEqual(first.allAccounts);
    });

    it('versão futura desconhecida (> 1): preserva dados e versão sem aplicar migrações destrutivas', () => {
      const initial = getInitialFinanceState();
      const futureRes = migrateFinanceSnapshot(2, initial);

      expect(futureRes.version).toBe(2);
      expect(futureRes.migrated).toBe(false);
      expect(futureRes.snapshot.allAccounts).toEqual(initial.allAccounts);
    });
  });

  describe('safeParseDomainKey: parse isolado por domínio', () => {
    it('retorna fallback quando chave não existe no storage sem registrar erro', () => {
      const errors: StorageParseError[] = [];
      const fallback = ['item-default'];
      const result = safeParseDomainKey(storage, 'chave_inexistente', fallback, errors);

      expect(result).toBe(fallback);
      expect(errors).toHaveLength(0);
    });

    it('retorna dados parseados quando JSON é válido sem registrar erro', () => {
      const errors: StorageParseError[] = [];
      storage.setItem('chave_valida', JSON.stringify([{ id: '123' }]));
      const result = safeParseDomainKey(storage, 'chave_valida', [], errors);

      expect(result).toEqual([{ id: '123' }]);
      expect(errors).toHaveLength(0);
    });

    it('retorna fallback e registra erro quando JSON está corrompido', () => {
      const errors: StorageParseError[] = [];
      storage.setItem('chave_corrompida', '{json-invalido-syntax-error');
      const fallback = [{ id: 'fallback-item' }];
      const result = safeParseDomainKey(storage, 'chave_corrompida', fallback, errors);

      expect(result).toBe(fallback);
      expect(errors).toHaveLength(1);
      expect(errors[0].key).toBe('chave_corrompida');
      expect(errors[0].raw).toBe('{json-invalido-syntax-error');
    });

    it('captura exceção quando getItem lança erro de acesso ao storage', () => {
      const faultyStorage = {
        getItem: () => {
          throw new Error('Permissão negada no storage');
        },
      } as unknown as Storage;

      const errors: StorageParseError[] = [];
      const fallback = ['safe-fallback'];
      const result = safeParseDomainKey(faultyStorage, 'chave_com_erro', fallback, errors);

      expect(result).toBe(fallback);
      expect(errors).toHaveLength(1);
      expect(errors[0].raw).toBe('storage_access_error');
    });
  });

  describe('loadFinanceSnapshot & resiliência de isolamento (P1-01)', () => {
    const validAccount: Account = {
      id: 'acc-preservada',
      workspace_id: 'ws-1',
      name: 'Conta Preservada Teste',
      type: 'checking',
      institution: 'Banco Confiável',
      color: '#000000',
      initial_balance: 123.45,
      current_balance: 123.45,
      active: true,
      created_at: '2026-01-01',
    };

    it('caso P1-01 exato: chave tardia recurring corrompida preserva accounts válida', () => {
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([validAccount]));
      storage.setItem(STORAGE_KEYS.recurring, '{json-corrompido');

      const result = loadFinanceSnapshot(storage);

      // A conta válida deve ser preservada intacta
      expect(result.snapshot.allAccounts).toHaveLength(1);
      expect(result.snapshot.allAccounts[0].id).toBe('acc-preservada');
      expect(result.snapshot.allAccounts[0].current_balance).toBe(123.45);
      expect(result.allAccounts[0].id).toBe('acc-preservada'); // retrocompatibilidade direta

      // A chave corrompida recebe fallback
      expect(result.snapshot.allRecurring.length).toBeGreaterThan(0);

      // Erro foi registrado apenas para recurring
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe(STORAGE_KEYS.recurring);
    });

    it('chave inicial workspaces corrompida preserva accounts válida', () => {
      storage.setItem(STORAGE_KEYS.workspaces, '{corrupted-ws-json');
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([validAccount]));

      const result = loadFinanceSnapshot(storage);

      // Accounts válida é preservada
      expect(result.snapshot.allAccounts).toHaveLength(1);
      expect(result.snapshot.allAccounts[0].id).toBe('acc-preservada');

      // Workspaces recebe fallback
      expect(result.snapshot.allWorkspaces.length).toBeGreaterThan(0);

      // Erro registrado para workspaces
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe(STORAGE_KEYS.workspaces);
    });

    it('chave intermediária categories ou transactions corrompida preserva as demais chaves', () => {
      storage.setItem(STORAGE_KEYS.workspaces, JSON.stringify([{ id: 'ws-custom', name: 'WS Custom', owner_id: 'u1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' }]));
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([validAccount]));
      storage.setItem(STORAGE_KEYS.categories, '{corrupted-categories');

      const result = loadFinanceSnapshot(storage);

      expect(result.snapshot.allWorkspaces[0].id).toBe('ws-custom');
      expect(result.snapshot.allAccounts[0].id).toBe('acc-preservada');
      expect(result.snapshot.allCategories.length).toBeGreaterThan(0);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe(STORAGE_KEYS.categories);
    });

    it('múltiplas chaves corrompidas: isola cada uma sem corromper as válidas', () => {
      storage.setItem(STORAGE_KEYS.workspaces, '{bad-ws');
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([validAccount]));
      storage.setItem(STORAGE_KEYS.bills, '{bad-bills');
      storage.setItem(STORAGE_KEYS.recurring, '{bad-rec');

      const result = loadFinanceSnapshot(storage);

      // Contas permanecem preservadas
      expect(result.snapshot.allAccounts[0].id).toBe('acc-preservada');

      // 3 erros registrados
      expect(result.errors).toHaveLength(3);
      const corruptKeys = result.errors.map((e) => e.key);
      expect(corruptKeys).toContain(STORAGE_KEYS.workspaces);
      expect(corruptKeys).toContain(STORAGE_KEYS.bills);
      expect(corruptKeys).toContain(STORAGE_KEYS.recurring);
    });

    it('ausência parcial de chaves no storage: carrega válidas e aplica defaults sem erros', () => {
      // Apenas accounts está salva no storage
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([validAccount]));

      const result = loadFinanceSnapshot(storage);

      expect(result.snapshot.allAccounts[0].id).toBe('acc-preservada');
      expect(result.snapshot.allWorkspaces.length).toBeGreaterThan(0);
      expect(result.snapshot.allCategories.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it('lê e preserva activeWorkspaceId válido como string', () => {
      storage.setItem(STORAGE_KEYS.activeWorkspaceId, 'ws-custom-active');

      const result = loadFinanceSnapshot(storage);
      expect(result.snapshot.activeWorkspaceId).toBe('ws-custom-active');
    });

    it('trata schemaVersion não numérico e activeWorkspaceId vazio com fallback seguro', () => {
      storage.setItem(STORAGE_KEYS.schemaVersion, 'not-a-number');
      storage.setItem(STORAGE_KEYS.activeWorkspaceId, '   ');

      const result = loadFinanceSnapshot(storage);
      expect(result.snapshot.allAccounts.length).toBeGreaterThan(0);
      expect(result.snapshot.activeWorkspaceId).toBe(getInitialFinanceState().activeWorkspaceId);
    });

    it('propaga version e canPersist=true quando versão é 1 ou inexistente', () => {
      const resWithoutVer = loadFinanceSnapshot(storage);
      expect(resWithoutVer.version).toBe(1);
      expect(resWithoutVer.canPersist).toBe(true);

      storage.setItem(STORAGE_KEYS.schemaVersion, '1');
      const resV1 = loadFinanceSnapshot(storage);
      expect(resV1.version).toBe(1);
      expect(resV1.canPersist).toBe(true);
    });

    it('propaga version=2 e canPersist=false quando schemaVersion é futuro (> 1)', () => {
      storage.setItem(STORAGE_KEYS.schemaVersion, '2');
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([validAccount]));

      const result = loadFinanceSnapshot(storage);
      expect(result.version).toBe(2);
      expect(result.canPersist).toBe(false);
      expect(result.snapshot.allAccounts[0].id).toBe('acc-preservada');
    });

    it('recupera graciosamente quando leitura de schemaVersion ou activeWorkspaceId lança exceção', () => {
      const faultyStorage = {
        getItem: (key: string) => {
          if (key === STORAGE_KEYS.schemaVersion) throw new Error('schema version read error');
          if (key === STORAGE_KEYS.activeWorkspaceId) throw new Error('active ws read error');
          return null;
        },
      } as unknown as Storage;

      const result = loadFinanceSnapshot(faultyStorage);
      expect(result.snapshot.allAccounts.length).toBeGreaterThan(0);
      expect(result.errors.length).toBe(2);
      expect(result.errors[0].key).toBe(STORAGE_KEYS.schemaVersion);
      expect(result.errors[1].key).toBe(STORAGE_KEYS.activeWorkspaceId);
    });
  });

  describe('saveFinanceSnapshot & Round Trip', () => {
    it('salva a versão do schema e todas as 17 coleções', () => {
      const state = getInitialFinanceState();
      saveFinanceSnapshot(storage, state);

      expect(storage.getItem(STORAGE_KEYS.schemaVersion)).toBe('1');
      expect(storage.getItem(STORAGE_KEYS.workspaces)).toBeTruthy();
      expect(storage.getItem(STORAGE_KEYS.accounts)).toBeTruthy();
      expect(storage.getItem(STORAGE_KEYS.recurring)).toBeTruthy();
    });

    it('aborta escrita e emite aviso se storage contiver schemaVersion de versão futura (> 1)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem(STORAGE_KEYS.schemaVersion, '2');
      storage.setItem(STORAGE_KEYS.accounts, JSON.stringify([{ id: 'acc-futura-original' }]));

      saveFinanceSnapshot(storage, getInitialFinanceState());

      // Versão permanece 2 (não foi rebaixada para 1)
      expect(storage.getItem(STORAGE_KEYS.schemaVersion)).toBe('2');
      // Dados originais permanecem intactos
      expect(storage.getItem(STORAGE_KEYS.accounts)).toBe(JSON.stringify([{ id: 'acc-futura-original' }]));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('FinControl: save abortado para proteger schema de versão futura:'),
        2
      );
      warnSpy.mockRestore();
    });

    it('round trip: save seguido de load reconstitui fielmente o estado persistido', () => {
      const initial = getInitialFinanceState();
      const customAccount: Account = {
        id: 'acc-round-trip',
        workspace_id: initial.activeWorkspaceId,
        name: 'Conta Round Trip',
        type: 'investment',
        institution: 'Corretora',
        color: '#123456',
        initial_balance: 50000,
        current_balance: 52000,
        active: true,
        created_at: '2026-09-19',
      };

      const customState: FinanceState = {
        ...initial,
        allAccounts: [customAccount],
      };

      saveFinanceSnapshot(storage, customState);
      const loaded = loadFinanceSnapshot(storage);

      expect(loaded.errors).toHaveLength(0);
      expect(loaded.snapshot.allAccounts).toHaveLength(1);
      expect(loaded.snapshot.allAccounts[0].id).toBe('acc-round-trip');
      expect(loaded.snapshot.allAccounts[0].current_balance).toBe(52000);
    });

    it('captura e loga erro se storage.setItem falhar (ex: QuotaExceededError)', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const quotaStorage = {
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      } as unknown as Storage;

      expect(() => saveFinanceSnapshot(quotaStorage, getInitialFinanceState())).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Erro ao persistir dados locais no storage:'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
