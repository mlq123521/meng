/**
 * 全局错误处理
 * 放在所有路由之后注册
 */

/** 404：没有路由匹配到 */
export function notFoundHandler(req: any, res: any) {
  res.status(404);
  if (req.accepts("html")) {
    res.render("error", {
      status: 404,
      title: "页面不存在",
      message: `找不到 ${req.originalUrl} 这个地址`,
      stack: null,
    });
  } else {
    res.json({ error: "Not Found", path: req.originalUrl });
  }
}

/**
 * 错误处理中间件：Express 靠「4 个参数」识别它，所以 error 参数必须写且不能省
 * 栈信息只打到控制台，绝不返回给用户
 */
export function errorHandler(err: any, req: any, res: any, next: any) {
  // 响应已经开始发送了，只能中断连接
  if (res.headersSent) {
    return next(err);
  }

  const status = Number(err?.status ?? err?.statusCode) || 500;

  // 数据库约束冲突 → 409
  if (err?.code === "23505") {
    res.status(409).render("error", { status: 409, title: "数据冲突", message: "记录已存在", stack: null });
    return;
  }
  // CHECK 约束冲突 → 400
  if (err?.code === "23514") {
    res.status(400).render("error", { status: 400, title: "数据不合法", message: "字段不符合数据库约束", stack: null });
    return;
  }

  // 4xx 是「客户端请求有问题」，不是服务器故障。
  // 只打一行摘要，不打堆栈 —— 否则一次限流/超限测试就能刷出几百行日志，真正的 500 反而被淹没。
  if (status >= 400 && status < 500) {
    console.warn(`[${status}] ${req.method} ${req.originalUrl} — ${err?.message ?? err}`);
  } else {
    // 5xx 才是真故障，完整记录
    console.error(`[ERROR ${status}] ${req.method} ${req.originalUrl}`, err);
  }

  // 生产环境不暴露内部错误细节
  const isProd = process.env.NODE_ENV === "production";
  const message = isProd
    ? status >= 500
      ? "服务器开小差了，请稍后重试"
      : err?.message || "请求有误"
    : err?.message || "未知错误";

  res.status(status).render("error", {
    status,
    title: status >= 500 ? "服务器错误" : "请求有误",
    message,
    stack: !isProd && status >= 500 ? err?.stack : null,
  });
}