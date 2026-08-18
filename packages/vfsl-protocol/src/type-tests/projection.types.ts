import type { PathAt, PathKind, PathSchema, PathValue, VfslPathMap } from '@nomicore/vfsl-protocol';

/**
 * 编译期断言（设计文档 §8.4 正/负例的缩小版）。
 * 本文件由 `pnpm typecheck` 检查；@ts-expect-error 行在投影正确时必然报错。
 */

// 模拟一个领域包的增广：类型树镜像结构树（§8.3）
declare module '@nomicore/vfsl-protocol' {
  interface VfslPathMap {
    assets: {
      byId: Record<
        string,
        PathSchema<{ id: string; kind: 'character' | 'scene'; name: string }, 'map'> & {
          name: PathSchema<string, 'leaf'>;
          profile: { portraitResourceId: PathSchema<string | null, 'leaf'> };
        }
      >;
    };
    shotTables: PathSchema<Array<{ id: string }>, 'array'>;
  }
}

// 正例：字面量路径投影出精确值类型
type NameValue = PathValue<PathAt<VfslPathMap, ['assets', 'byId', string, 'name']>>;
const nameOk: NameValue = 'hero';
// @ts-expect-error name 处只接受 string
const nameBad: NameValue = 42;

type PortraitValue = PathValue<PathAt<VfslPathMap, ['assets', 'byId', string, 'profile', 'portraitResourceId']>>;
const portraitOk: PortraitValue = null;
// @ts-expect-error portraitResourceId 接受 string | null，不接受 number
const portraitBad: PortraitValue = 1;

type EntityValue = PathValue<PathAt<VfslPathMap, ['assets', 'byId', string]>>;
const entity: EntityValue = { id: 'a1', kind: 'scene', name: 's' };

type NameKind = PathKind<PathAt<VfslPathMap, ['assets', 'byId', string, 'name']>>;
const nameKind: NameKind = 'leaf';
// @ts-expect-error kind 投影为 'leaf'
const nameKindBad: NameKind = 'map';

// 负例：未知路径 fail-closed（§8.5：字段重命名后旧路径编译失败）
type UnknownSeg = PathValue<PathAt<VfslPathMap, ['assets', 'nope']>>;
// @ts-expect-error UnknownPath 不能赋给 string
const unknownSeg: string = null as never as UnknownSeg;

// 负例：数组内部不可按路径下钻（append 语义）
type ArrayIndex = PathValue<PathAt<VfslPathMap, ['shotTables', '0']>>;
// @ts-expect-error 下标路径投影成 UnknownPath
const arrayIndex: string = null as never as ArrayIndex;

export const __typeAssertions = {
  nameOk,
  nameBad,
  portraitOk,
  portraitBad,
  entity,
  nameKind,
  nameKindBad,
  unknownSeg,
  arrayIndex,
};
