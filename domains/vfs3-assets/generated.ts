/**
 * GENERATED FILE — DO NOT EDIT.
 * Generator: @nomicore/vfsl-codegen@0.1.1
 * Source hash: sha256:82e98fa1546b9548f32795dd51e9212eaf35e4731939a1c4db5c8f3b03b93c69
 * Regenerate with: pnpm generate
 */

import type { PathSchema } from '@nomicore/vfsl-protocol';

/**  vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位）  */
/**  资产 ID：键约束由 Pattern 定义，禁 "." 与 "|"  */
export type AssetId = string;
/**  审计信息：所有写入留痕  */
export type Audit = { 'createdBy': PathSchema<string, 'leaf'>; 'createdAt': PathSchema<number, 'leaf'> };
/**  资产实体：按 kind 判别的封闭联合  */
export type AssetEntity =
  | { 'kind': PathSchema<'image', 'leaf'>; 'url': PathSchema<string, 'leaf'>; 'width': PathSchema<number, 'leaf'>; 'height': PathSchema<number, 'leaf'>; 'audit': PathSchema<Audit, 'map'> }
  | { 'kind': PathSchema<'text', 'leaf'>; 'body': PathSchema<string, 'xml-fragment'>; 'audit': PathSchema<Audit, 'map'> }
  | { 'kind': PathSchema<'file', 'leaf'>; 'name': PathSchema<string, 'leaf'>; 'size': PathSchema<number, 'leaf'>; 'tags': PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>; 'audit': PathSchema<Audit, 'map'> };
/**  附件：与 Yjs 同步无关的纯值数组  */
export type Attachments = string[];

declare module '@nomicore/vfsl-protocol' {
  /**  ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束  */
  interface VfslPathMap {
    assets: PathSchema<Record<string, PathSchema<AssetEntity, 'map'>>, 'map'>;
    attachments: PathSchema<Attachments, 'plain'>;
    audit: PathSchema<Audit, 'map'>;
    /**  @semantic 可选说明字段  */
    notes?: PathSchema<string, 'leaf'>;
    keywords: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>;
  }
}
