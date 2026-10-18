import { Router } from "express";
import demandRoutes from "./demand";
import profileRoutes from "./profile";

/** 总路由：把各业务模块的路由表合并挂载 */
const router = Router();

router.use("/", demandRoutes);  // 需求登记
router.use("/", profileRoutes); // 客户档案

export default router;