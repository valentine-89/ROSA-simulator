export default async function main(input, rosa) {
  const rows = await rosa.db.macro('stock-find', { sku: input.sku });
  const state = await rosa.iot.latest('device');
  console.log('Đã tìm', rows.length, 'mặt hàng');
  return { rows, state };
}
