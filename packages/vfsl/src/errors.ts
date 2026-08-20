/**
 * 错误码注册表 + VfslIssue 构造（v1 规格 §4 错误码传递通道）。
 *
 * 公共接缝无独立 code 字段（PRD #3 冻结 `{ message, line, column }`），错误码
 * 以 message 的冻结前缀格式 `VFSL-E<编号>: <人类可读消息>` 传递——前缀是冻结项，
 * 消息正文措辞不冻结（规格 §4）。
 */
import type { VfslIssue } from './ir.js';

/** 本切片实现的错误码注册表（v1 规格 §4 总表；21 个（E310/E311 随 #19 ROOT 约定交付）——E304/E306/E307/E309 随 #6、E305 随 #7 交付）。 */
export const ErrCode = {
  E100: '100',
  E101: '101',
  E102: '102',
  E103: '103',
  E104: '104',
  E105: '105',
  E106: '106',
  E201: '201',
  E202: '202',
  E203: '203',
  E301: '301',
  E302: '302',
  E303: '303',
  E304: '304',
  E305: '305',
  E306: '306',
  E307: '307',
  E308: '308',
  E309: '309',
  E310: '310',
  E311: '311',
} as const;

/** 构造 VfslIssue：message 携带冻结前缀（三位编号恒为 3 位，直接模板插值）。 */
export function makeIssue(code: string, message: string, line: number, column: number): VfslIssue {
  return { message: `VFSL-E${code}: ${message}`, line, column };
}
