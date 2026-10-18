import path from "node:path";
import express from "express";
import router from "./routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

const app = express();

/* 1. 基础配置 */
app.set("view engine", "ejs");
app.set("views", path.join(import.meta.dir, "views"));
app.disable("x-powered-by"); // 不暴露 Express 标识

/* 2. 请求体解析（大小限制 100kb，防止超大 body 打满内存） */
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

/* 3. 安全响应头 */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff"); // 禁止浏览器猜 MIME
  res.setHeader("X-Frame-Options", "DENY");// 禁止被 iframe 嵌套（点击劫持）
  next();
});

/* 4. 业务路由 */
app.use("/", router);

/* 5. 兜底：必须注册在所有路由之后 */
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(3000, () => console.log("http://localhost:3000"));