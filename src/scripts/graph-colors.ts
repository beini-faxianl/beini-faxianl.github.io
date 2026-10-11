/** 分类配色（与关系图谱一致），可在服务端与客户端共用 */
export const CATEGORY_PALETTE = ['--clay', '--sky', '--olive', '--fig', '--plum', '--mineral', '--kraft', '--poppy', '--pencil'];

export function categoryColorVar(index: number) {
  const n = CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[((index % n) + n) % n];
}
