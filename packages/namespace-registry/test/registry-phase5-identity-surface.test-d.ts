/**
 * SA6 红灯锚定（类型面）— issue #131（Phase 5 切片 1）AC-1/AC-6/AC-7：
 * Registry 公共类型面与 ADR 0010 词汇对齐（runtime 行为锚见
 * registry-phase5-identity-red.test.ts）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - 【红】`CreateNamespaceInput` 不再携带调用方 `namespaceId`（ADR 0010：
 *   create 输入只含 owner、schema、root）→ 当前类型面仍有该键 → 条件类型
 *   求值 `true` → `never` 赋值 TS2322 → 红；SA3 删除该键 → 绿。
 * - 【红】生产工厂与 testing seam 必须暴露注入的受控 128-bit 随机字节
 *   能力 `randomBytes(length): Uint8Array`（ADR 0009 依赖纪律：缺失即响亮
 *   失败——运行时构造门禁见行为测试）→ 当前两类型面均无此键 → 红；
 *   SA3 增加该键 → 绿。
 * - 【绿（保持性守卫）】Persistence 公共面不新增跨 owner catalog API
 *   （AC-5：不新增 list/listNamespaces/catalog）——现契约已满足，防回潮。
 * - 【绿（保持性守卫）】create 输入仍具 owner/schema/root 三键（AC-4 投影、
 *   AC-1 生成面的载体）。
 */
import { describe, it } from 'vitest';
import type {
  CreateNamespaceInput,
  CreateNamespaceRegistryOptions,
  NamespaceOwner,
} from '@nomicore/namespace-registry';
import type { NamespaceRegistryTestingOverrides } from '@nomicore/namespace-registry/testing';
import type { DocPersistence } from '@nomicore/persistence';

type HasCallerNamespaceId<T> = T extends { readonly namespaceId: string } ? true : false;
type CallerNsIdMustBeAbsent<T> = HasCallerNamespaceId<T> extends true ? never : true;

type HasRandomCapability<T> = T extends { readonly randomBytes: (length: number) => Uint8Array } ? true : never;

type HasCatalogApi<T> = T extends
  | { readonly listNamespaces: unknown }
  | { readonly listDocs: unknown }
  | { readonly catalog: unknown }
  ? true
  : false;

type ThreeKeyShape = { readonly owner: NamespaceOwner; readonly schema: unknown; readonly root: unknown };

describe('类型面：create 输入无调用方 namespaceId（AC-1）', () => {
  it('CreateNamespaceInput 不得存在 namespaceId 键', () => {
    const preserve: CallerNsIdMustBeAbsent<CreateNamespaceInput> = true;
    void preserve;
  });

  it('create 输入仍具 owner/schema/root 三键（保持性守卫）', () => {
    const stillThreeKeys: CreateNamespaceInput extends ThreeKeyShape ? true : never = true;
    void stillThreeKeys;
  });
});

describe('类型面：受控随机源注入（AC-1/AC-6，构造期门禁的行为锚见运行时套件）', () => {
  it('CreateNamespaceRegistryOptions 暴露 randomBytes(length: number): Uint8Array', () => {
    const prodHasRandom: HasRandomCapability<CreateNamespaceRegistryOptions> = true;
    void prodHasRandom;
  });

  it('NamespaceRegistryTestingOverrides 暴露同款 randomBytes', () => {
    const testingHasRandom: HasRandomCapability<NamespaceRegistryTestingOverrides> = true;
    void testingHasRandom;
  });
});

describe('类型面：Persistence 不新增跨 owner catalog（AC-5 保持性守卫）', () => {
  it('DocPersistence 无 listNamespaces/listDocs/catalog 成员', () => {
    const noCatalog: HasCatalogApi<DocPersistence> extends true ? never : true = true;
    void noCatalog;
  });
});
