import { Router } from "express";
import multer from "multer";
import {
  list,
  exportCsv,
  downloadTemplate,
  importPage,
  importCsv,
  rollbackImport,
  form,
  create,
  detail,
  editForm,
  update,
  remove,
} from "../controllers/profileController";

/** 客户档案模块 */
const router = Router();

/**
 * multer：解析 multipart/form-data 文件上传
 * memoryStorage —— 文件留在内存里不落盘，解析完即弃
 * limits：单文件最大 2MB（应用层还有一道同样的检查）
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

/* ⚠️ 静态路由必须写在动态路由前面，否则：
   /profiles/new          会被 /profiles/:id 抢先匹配
   /profiles/export.csv   会被 /profiles/:id 抢先匹配
   /profiles/import       会被 /profiles/:id 抢先匹配
   /profiles/template.csv 会被 /profiles/:id 抢先匹配 */

/* 导入相关 */
router.get("/profiles/template.csv", downloadTemplate);
router.get("/profiles/import", importPage);
router.post("/profiles/import/rollback", rollbackImport);
router.post("/profiles/import", upload.single("file"), importCsv);

/* 导出 */
router.get("/profiles/export.csv", exportCsv);

/* 建档 */
router.get("/profiles/new", form);
router.post("/profiles", create);

/* 查询 */
router.get("/profiles", list);
router.get("/profiles/:id", detail);

/* 编辑 */
router.get("/profiles/:id/edit", editForm);
router.post("/profiles/:id", update);

/* 删除 */
router.post("/profiles/:id/delete", remove);

export default router;