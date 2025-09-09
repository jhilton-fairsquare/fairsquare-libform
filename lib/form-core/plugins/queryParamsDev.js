
export const queryparams = (options = {}) => {
  const state = {};
  return {
    init(ctx) {
      const qp = 'test';

      const prevOnSubmit = ctx.onSubmit;
      ctx.onSubmit = (values) => {
        const base = prevOnSubmit ? prevOnSubmit(values) : values;
        const payload = base || values || {};
        return { qp, ...payload };
      };
      
    },
    onValidationFail(errors, ctx) {
      // react to validation issues
    },
    async onSuccess(res, ctx) {
      // react to server success
    },
    onError(err, ctx) {
      // react to server error
    },
  };
};
