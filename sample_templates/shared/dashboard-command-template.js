(function () {
  var signedInUserPromise = null;
  var COMMAND_PLACEHOLDER_PATTERN = /<<email>>|<<username>>|<<phone>>/gi;

  function hasCommandPlaceholders(command) {
    var template = String(command == null ? '' : command);
    COMMAND_PLACEHOLDER_PATTERN.lastIndex = 0;
    return COMMAND_PLACEHOLDER_PATTERN.test(template);
  }

  function normalizeSignedInUser(data) {
    if (!data || !data.authenticated || !data.user) {
      return { email: '', username: '', phone: '' };
    }
    return {
      email: String(data.user.email || '').trim(),
      username: String(data.user.name || data.user.email || '').trim(),
      phone: String(data.user.phone || '').trim()
    };
  }

  function getSignedInUser() {
    if (signedInUserPromise) {
      return signedInUserPromise;
    }
    signedInUserPromise = fetch('/api/auth/google/status', {
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) {
        return null;
      }
      return response.json().catch(function () { return null; });
    }).then(function (data) {
      return normalizeSignedInUser(data);
    }).catch(function () {
      return { email: '', username: '' };
    }).finally(function () {
      signedInUserPromise = null;
    });
    return signedInUserPromise;
  }

  function replaceCommandPlaceholders(command, user) {
    var template = String(command == null ? '' : command);
    if (!hasCommandPlaceholders(template)) {
      return template;
    }

    var email = String((user && user.email) || '').trim();
    var username = String((user && user.username) || '').trim();
    var phone = String((user && user.phone) || '').trim();

    return template
      .replace(/<<email>>/gi, email)
      .replace(/<<username>>/gi, username)
      .replace(/<<phone>>/gi, phone);
  }

  function resolveCommandTemplate(command) {
    var template = String(command == null ? '' : command);
    if (!hasCommandPlaceholders(template)) {
      return Promise.resolve(template);
    }
    return getSignedInUser().then(function (user) {
      return replaceCommandPlaceholders(template, user);
    }).catch(function () {
      return replaceCommandPlaceholders(template, { email: '', username: '', phone: '' });
    });
  }

  window.AIBridgeCommandTemplate = {
    getSignedInUser: getSignedInUser,
    replaceCommandPlaceholders: replaceCommandPlaceholders,
    resolveCommandTemplate: resolveCommandTemplate
  };
})();
