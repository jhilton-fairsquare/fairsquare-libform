export const yourPlugin = (options = {}) => {
  const state = {};
  return {
    init(ctx) {
      // setup, wrap ctx.onSubmit, attach listeners, etc.
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
