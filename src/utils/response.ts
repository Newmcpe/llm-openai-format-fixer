export type SuccessResponse<T> = {
  success: true;
  data: T;
};

export type ErrorResponse = {
  success: false;
  error: {
    message: string;
    details?: unknown;
  };
};

export const buildSuccessResponse = <T>(data: T): SuccessResponse<T> => ({
  success: true,
  data,
});

export const buildErrorResponse = (message: string, details?: unknown): ErrorResponse => ({
  success: false,
  error: details === undefined ? { message } : { message, details },
});
