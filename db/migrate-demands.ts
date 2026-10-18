/**
 * 迁移：customers（需求登记）→ demands（挂在客户档案下）
 *
 * 步骤
 * 1. 建 demands 表
 * 2. 老的每条需求，按 phone 找对应客户档案：
 *    找到 → 直接挂上
 *    没找到 → 用需求里的 客户名/联系人/手机 自动建一份档案
 * 3. 校验迁移结果
 * 4. 删掉老的 customers 表
 *
 * 运行：bun run --env-file=.env db/migrate-demands.ts
 */
import { SQL } from "bun";
import { db } from "../index";

const sql = new SQL(process.env.DATABASE_URL!);

console.log("▶ 迁移开始：customers → demands\n");

/* ── 1. 建新表 ── */
console.log("1) 创建 demands 表");
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS demands (
    id          serial PRIMARY KEY,
    profile_id  integer NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    demand      text NOT NULL,
    status      text NOT NULL DEFAULT '待跟进',
    remark      text,
    created_at  timestamp NOT NULL DEFAULT now(),
    CONSTRAINT demands_demand_len   CHECK (char_length(demand) BETWEEN 1 AND 1000),
    CONSTRAINT demands_remark_len   CHECK (remark IS NULL OR char_length(remark) <= 500),
    CONSTRAINT demands_status_valid CHECK (status = ANY (ARRAY['待跟进','沟通中','已报价','已成交','已流失']))
  )
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS demands_profile_idx ON demands(profile_id)`);
console.log("   ✓ 表已建");

/* ── 2. 检查老表是否存在 ── */
const hasOld = await sql`
  SELECT count(*)::int AS n FROM information_schema.tables
  WHERE table_schema='public' AND table_name='customers'
`;
if (Number(hasOld[0].n) === 0) {
  console.log("\n2) 老表 customers 不存在，跳过数据搬迁");
} else {
  /* ── 3. 搬迁数据 ── */
  const old = await sql`
    SELECT id, customer_name, contact_name, phone, demand, status, remark, created_at
    FROM customers ORDER BY id
  `;
  console.log(`\n2) 待迁移 ${old.length} 条需求`);

  let linked = 0;
  let createdProfile = 0;

  for (const row of old) {
    // 按手机号找档案
    const found = await sql`
      SELECT id FROM customer_profiles WHERE phone = ${row.phone} LIMIT 1
    `;

    let profileId: number;
    if (found.length > 0) {
      profileId = Number(found[0].id);
      linked++;
    } else {
      // 没有对应档案 → 用需求里的信息自动建一份
      const [np] = await sql`
        INSERT INTO customer_profiles (company_name, contact_name, phone, source, created_at)
        VALUES (${row.customer_name}, ${row.contact_name}, ${row.phone}, '其他', ${row.created_at})
        ON CONFLICT (phone) DO UPDATE SET company_name = EXCLUDED.company_name
        RETURNING id
      `;
      profileId = Number(np.id);
      createdProfile++;
    }

    await sql`
      INSERT INTO demands (profile_id, demand, status, remark, created_at)
      VALUES (${profileId}, ${row.demand}, ${row.status}, ${row.remark}, ${row.created_at})
    `;
  }

  console.log(`   ✓ ${linked} 条挂到已有档案`);
  console.log(`   ✓ ${createdProfile} 条新建了对应档案`);

  /* ── 4. 校验 ── */
  const check = await sql`
    SELECT
      (SELECT count(*)::int FROM customers) AS old_count,
      (SELECT count(*)::int FROM demands)  AS new_count,
      (SELECT count(*)::int FROM demands d
        LEFT JOIN customer_profiles p ON p.id = d.profile_id
        WHERE p.id IS NULL) AS orphan_count
  `;
  const row = check[0];
  console.log(`\n3) 校验：老表 ${row.old_count} 条 → 新表 ${row.new_count} 条，孤儿需求 ${row.orphan_count} 条`);

  if (Number(row.old_count) !== Number(row.new_count)) {
    console.error("   ✘ 条数不一致，终止迁移（未删除老表）");
    await sql.close();
    process.exit(1);
  }
  if (Number(row.orphan_count) > 0) {
    console.error("   ✘ 存在没有客户档案的孤儿需求，终止迁移（未删除老表）");
    await sql.close();
    process.exit(1);
  }
  console.log("   ✓ 校验通过");

  /* ── 5. 删老表 ── */
  console.log("\n4) 删除老表 customers");
  await sql.unsafe(`DROP TABLE IF EXISTS customers`);
  console.log("   ✓ 已删除");
}

console.log("\n▶ 迁移完成");
console.log("  现在结构：customer_profiles（客户档案）1 ── N demands（需求登记）");
await sql.close();
process.exit(0);