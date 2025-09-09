
export const queryparams = (options = {}) => {
  const state = {};
  return {
    init(ctx) {
      const qp = 'test';
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
