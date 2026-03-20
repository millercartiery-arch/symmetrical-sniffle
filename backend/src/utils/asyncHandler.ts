/**
 * 统一路由包装：未捕获的 throw/await 会进入 next(err)，由全局 errorHandler 处理，防止错误被 swallow。
 */
import type { Request, Response, NextFunction } from "express";

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
