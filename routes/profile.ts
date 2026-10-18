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
} from "../controllers/profileController";

/** 客户档案模块 */
const router = Router();

/* ⚠️ 静态路由必须写在动态路由前面，否则：
   /profiles/new       会被 /profiles/:id 抢先匹配（new 被当成 id）
   /profiles/export.csv 会被 /profiles/:id 抢先匹配（export.csv 被当成 id） */

/* 导出（固定路径，必须在 :id 之前） */
router.get("/profiles/export.csv", exportCsv);

/* 建档 */
router.get("/profiles/new", form);
router.post("/profiles", create);

/* 查询 */
router.get("/profiles", list);          // 档案列表 + 筛选分页
router.get("/profiles/:id", detail);    // 档案详情

/* 编辑 */
router.get("/profiles/:id/edit", editForm);
router.post("/profiles/:id", update);

/* 删除 */
router.post("/profiles/:id/delete", remove);

export default router;