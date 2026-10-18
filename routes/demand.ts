import { Router } from "express";
import {
  list,
  exportCsv,
  form,
  create,
  detail,
  editForm,
  update,
  remove,
} from "../controllers/demandController";

/** 需求登记模块 */
const router = Router();

/* ⚠️ 静态路由必须写在动态路由前面，否则：
   /export.csv 会被 /demands/:id 抢先匹配（export.csv 被当成 id） */

/* 导出 */
router.get("/export.csv", exportCsv);

/* 新增 */
router.get("/new", form);
router.post("/", create);

/* 查询 */
router.get("/", list);                    // 列表 + 搜索筛选 + 分页
router.get("/demands/:id", detail);       // 详情

/* 编辑 */
router.get("/demands/:id/edit", editForm);
router.post("/demands/:id", update);

/* 删除 */
router.post("/demands/:id/delete", remove);

export default router;