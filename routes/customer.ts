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
} from "../controllers/customerController";

/** 需求登记模块 */
const router = Router();

/* 查询 */
router.get("/", list);                    // 列表 + 搜索筛选 + 分页
router.get("/export.csv", exportCsv);     // 导出 CSV（不分页）
router.get("/customers/:id", detail);     // 详情

/* 新增 */
router.get("/new", form);                 // 新建表单
router.post("/", create);                 // 提交新建

/* 编辑 */
router.get("/customers/:id/edit", editForm);
router.post("/customers/:id", update);

/* 删除 */
router.post("/customers/:id/delete", remove);

export default router;