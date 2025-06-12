import { AcquisitionManager as Sdk } from "code-push/script/acquisition-sdk";
import { Alert } from "./AlertAdapter";
import requestFetchAdapter from "./request-fetch-adapter";
import { AppState, Platform } from "react-native";
import log from "./logging";
import hoistStatics from "hoist-non-react-statics";

let NativeCodePush = require("react-native").NativeModules.CodePush;
const PackageMixins = require("./package-mixins")(NativeCodePush);

async function checkForUpdate(
  deploymentKey = null,
  handleBinaryVersionMismatchCallback = null
) {
  /*
   * Before we ask the server if an update exists, we
   * need to retrieve three pieces of information from the
   * native side: deployment key, app version (e.g. 1.0.1)
   * and the hash of the currently running update (if there is one).
   * This allows the client to only receive updates which are targetted
   * for their specific deployment and version and which are actually
   * different from the CodePush update they have already installed.
   */
  const nativeConfig = await getConfiguration();
  /*
   * If a deployment key was explicitly provided,
   * then let's override the one we retrieved
   * from the native-side of the app. This allows
   * dynamically "redirecting" end-users at different
   * deployments (e.g. an early access deployment for insiders).
   */
  const config = deploymentKey
    ? { ...nativeConfig, ...{ deploymentKey } }
    : nativeConfig;
  const sdk = getPromisifiedSdk(requestFetchAdapter, config);

  // Use dynamically overridden getCurrentPackage() during tests.
  const localPackage = await module.exports.getCurrentPackage();

  /*
   * If the app has a previously installed update, and that update
   * was targetted at the same app version that is currently running,
   * then we want to use its package hash to determine whether a new
   * release has been made on the server. Otherwise, we only need
   * to send the app version to the server, since we are interested
   * in any updates for current binary version, regardless of hash.
   */
  let queryPackage;
  if (localPackage) {
    queryPackage = localPackage;
  } else {
    queryPackage = { appVersion: config.appVersion };
    if (Platform.OS === "ios" && config.packageHash) {
      queryPackage.packageHash = config.packageHash;
    }
  }

  /**
   * 업데이트 확인 수행
   * sharedCodePushOptions.updateChecker가 설정된 경우 커스텀 업데이트 체커를 사용하고, 그렇지 않으면 기본 SDK 사용
   */
  const update = sharedCodePushOptions.updateChecker
    ? await (async () => {
        /**
         * UpdateCheckRequest 타입에 맞춰 요청 객체 생성
         * CodePush SDK 내부 타입 참조
         */
        const updateRequest = {
          deployment_key: config.deploymentKey,
          app_version: queryPackage.appVersion,
          package_hash: queryPackage.packageHash,
          is_companion: config.ignoreAppVersion,
          label: queryPackage.label,
          client_unique_id: config.clientUniqueId,
        };

        // 커스텀 업데이트 체커 함수 호출
        const response = await sharedCodePushOptions.updateChecker(
          updateRequest
        );

        /**
         * CodePush SDK 내부 처리 로직에서 추출한 응답 처리
         * 업데이트 시나리오별 분기 처리
         */
        const updateInfo = response.update_info;

        // 케이스 1: 업데이트 정보가 없음
        if (!updateInfo) {
          return null;
        }
        // 케이스 2: 바이너리(앱 스토어) 업데이트 필요
        else if (updateInfo.update_app_version) {
          return {
            updateAppVersion: true,
            appVersion: updateInfo.target_binary_range,
          };
        }
        // 케이스 3: 업데이트가 있지만 사용 불가능
        else if (!updateInfo.is_available) {
          return null;
        }

        /**
         * 케이스 4: 정상적인 CodePush 업데이트
         * RemotePackage 타입 형식으로 변환 (CodePush SDK 내부 타입 참조)
         * null 병합 연산자(??)로 기본값 처리
         */
        return {
          deploymentKey: config.deploymentKey,
          description: updateInfo.description ?? "",
          label: updateInfo.label ?? "",
          appVersion: updateInfo.target_binary_range ?? "",
          isMandatory: updateInfo.is_mandatory ?? false,
          packageHash: updateInfo.package_hash ?? "",
          packageSize: updateInfo.package_size ?? 0,
          downloadUrl: updateInfo.download_url ?? "",
        };
      })()
    : await sdk.queryUpdateWithCurrentPackage(queryPackage);

  const fileName =
    update && typeof update.downloadUrl === "string"
      ? update.downloadUrl.split("/").pop()
      : null;

  if (sharedCodePushOptions.bundleHost && fileName) {
    update.downloadUrl = sharedCodePushOptions.bundleHost + fileName;
  }

  /*
   * checkForUpdate가 null을 반환하는 네 가지 경우:
   * ----------------------------------------------------------------
   * 1) 서버가 업데이트가 없다고 응답. 가장 일반적인 경우
   * 2) 서버가 업데이트가 있지만 더 새로운 바이너리 버전이 필요하다고 응답
   *    최종 사용자가 사용 가능한 것보다 오래된 바이너리 버전을 실행 중일 때 발생
   * 3) 서버가 업데이트가 있다고 했지만, 업데이트의 해시가 현재 실행 중인 업데이트와 동일
   *    서버에 버그가 없는 한 절대 발생하면 안 되지만, 클라이언트 앱의 복원력을 위해 확인
   * 4) 서버가 업데이트가 있다고 했지만, 업데이트의 해시가 바이너리의 현재 실행 버전과 동일
   *    Android에서만 발생해야 함 - iOS와 달리 Android에서는 아직 바이너리 버전에 대한
   *    diff 업데이트 설치를 피하기 위해 updateCheck 요청에 바이너리 해시를 첨부하지 않음
   */
  if (
    !update ||
    update.updateAppVersion ||
    (localPackage && update.packageHash === localPackage.packageHash) ||
    ((!localPackage || localPackage._isDebugOnly) &&
      config.packageHash === update.packageHash)
  ) {
    if (update && update.updateAppVersion) {
      log(
        "An update is available but it is not targeting the binary version of your app."
      );
      if (
        handleBinaryVersionMismatchCallback &&
        typeof handleBinaryVersionMismatchCallback === "function"
      ) {
        handleBinaryVersionMismatchCallback(update);
      }
    }

    return null;
  } else {
    const remotePackage = {
      ...update,
      ...PackageMixins.remote(sdk.reportStatusDownload),
    };
    remotePackage.failedInstall = await NativeCodePush.isFailedUpdate(
      remotePackage.packageHash
    );
    remotePackage.deploymentKey = deploymentKey || nativeConfig.deploymentKey;
    return remotePackage;
  }
}

const getConfiguration = (() => {
  let config;
  return async function getConfiguration() {
    if (config) {
      return config;
    } else if (testConfig) {
      return testConfig;
    } else {
      config = await NativeCodePush.getConfiguration();
      return config;
    }
  };
})();

async function getCurrentPackage() {
  return await getUpdateMetadata(CodePush.UpdateState.LATEST);
}

async function getUpdateMetadata(updateState) {
  let updateMetadata = await NativeCodePush.getUpdateMetadata(
    updateState || CodePush.UpdateState.RUNNING
  );
  if (updateMetadata) {
    updateMetadata = { ...PackageMixins.local, ...updateMetadata };
    updateMetadata.failedInstall = await NativeCodePush.isFailedUpdate(
      updateMetadata.packageHash
    );
    updateMetadata.isFirstRun = await NativeCodePush.isFirstRun(
      updateMetadata.packageHash
    );
  }
  return updateMetadata;
}

function getPromisifiedSdk(requestFetchAdapter, config) {
  // Use dynamically overridden AcquisitionSdk during tests.
  const sdk = new module.exports.AcquisitionSdk(requestFetchAdapter, config);
  sdk.queryUpdateWithCurrentPackage = (queryPackage) => {
    return new Promise((resolve, reject) => {
      module.exports.AcquisitionSdk.prototype.queryUpdateWithCurrentPackage.call(
        sdk,
        queryPackage,
        (err, update) => {
          if (err) {
            reject(err);
          } else {
            resolve(update);
          }
        }
      );
    });
  };

  sdk.reportStatusDeploy = (
    deployedPackage,
    status,
    previousLabelOrAppVersion,
    previousDeploymentKey
  ) => {
    return new Promise((resolve, reject) => {
      module.exports.AcquisitionSdk.prototype.reportStatusDeploy.call(
        sdk,
        deployedPackage,
        status,
        previousLabelOrAppVersion,
        previousDeploymentKey,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  };

  sdk.reportStatusDownload = (downloadedPackage) => {
    return new Promise((resolve, reject) => {
      module.exports.AcquisitionSdk.prototype.reportStatusDownload.call(
        sdk,
        downloadedPackage,
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  };

  return sdk;
}

// This ensures that notifyApplicationReadyInternal is only called once
// in the lifetime of this module instance.
const notifyApplicationReady = (() => {
  let notifyApplicationReadyPromise;
  return () => {
    if (!notifyApplicationReadyPromise) {
      notifyApplicationReadyPromise = notifyApplicationReadyInternal();
    }

    return notifyApplicationReadyPromise;
  };
})();

async function notifyApplicationReadyInternal() {
  await NativeCodePush.notifyApplicationReady();
  const statusReport = await NativeCodePush.getNewStatusReport();
  statusReport && tryReportStatus(statusReport); // Don't wait for this to complete.

  return statusReport;
}

async function tryReportStatus(statusReport, retryOnAppResume) {
  const config = await getConfiguration();
  const previousLabelOrAppVersion = statusReport.previousLabelOrAppVersion;
  const previousDeploymentKey =
    statusReport.previousDeploymentKey || config.deploymentKey;
  try {
    if (statusReport.appVersion) {
      log(`Reporting binary update (${statusReport.appVersion})`);

      if (!config.deploymentKey) {
        throw new Error("Deployment key is missed");
      }

      const sdk = getPromisifiedSdk(requestFetchAdapter, config);
      await sdk.reportStatusDeploy(
        /* deployedPackage */ null,
        /* status */ null,
        previousLabelOrAppVersion,
        previousDeploymentKey
      );
    } else {
      const label = statusReport.package.label;
      if (statusReport.status === "DeploymentSucceeded") {
        log(`Reporting CodePush update success (${label})`);
      } else {
        log(`Reporting CodePush update rollback (${label})`);
        await NativeCodePush.setLatestRollbackInfo(
          statusReport.package.packageHash
        );
      }

      config.deploymentKey = statusReport.package.deploymentKey;
      const sdk = getPromisifiedSdk(requestFetchAdapter, config);
      await sdk.reportStatusDeploy(
        statusReport.package,
        statusReport.status,
        previousLabelOrAppVersion,
        previousDeploymentKey
      );
    }

    NativeCodePush.recordStatusReported(statusReport);
    retryOnAppResume && retryOnAppResume.remove();
  } catch (e) {
    log(`Report status failed: ${JSON.stringify(statusReport)}`);
    NativeCodePush.saveStatusReportForRetry(statusReport);
    // Try again when the app resumes
    if (!retryOnAppResume) {
      const resumeListener = AppState.addEventListener(
        "change",
        async (newState) => {
          if (newState !== "active") return;
          const refreshedStatusReport =
            await NativeCodePush.getNewStatusReport();
          if (refreshedStatusReport) {
            tryReportStatus(refreshedStatusReport, resumeListener);
          } else {
            resumeListener && resumeListener.remove();
          }
        }
      );
    }
  }
}

async function shouldUpdateBeIgnored(remotePackage, syncOptions) {
  let { rollbackRetryOptions } = syncOptions;

  const isFailedPackage = remotePackage && remotePackage.failedInstall;
  if (!isFailedPackage || !syncOptions.ignoreFailedUpdates) {
    return false;
  }

  if (!rollbackRetryOptions) {
    return true;
  }

  if (typeof rollbackRetryOptions !== "object") {
    rollbackRetryOptions = CodePush.DEFAULT_ROLLBACK_RETRY_OPTIONS;
  } else {
    rollbackRetryOptions = {
      ...CodePush.DEFAULT_ROLLBACK_RETRY_OPTIONS,
      ...rollbackRetryOptions,
    };
  }

  if (!validateRollbackRetryOptions(rollbackRetryOptions)) {
    return true;
  }

  const latestRollbackInfo = await NativeCodePush.getLatestRollbackInfo();
  if (
    !validateLatestRollbackInfo(latestRollbackInfo, remotePackage.packageHash)
  ) {
    log("The latest rollback info is not valid.");
    return true;
  }

  const { delayInHours, maxRetryAttempts } = rollbackRetryOptions;
  const hoursSinceLatestRollback =
    (Date.now() - latestRollbackInfo.time) / (1000 * 60 * 60);
  if (
    hoursSinceLatestRollback >= delayInHours &&
    maxRetryAttempts >= latestRollbackInfo.count
  ) {
    log("Previous rollback should be ignored due to rollback retry options.");
    return false;
  }

  return true;
}

function validateLatestRollbackInfo(latestRollbackInfo, packageHash) {
  return (
    latestRollbackInfo &&
    latestRollbackInfo.time &&
    latestRollbackInfo.count &&
    latestRollbackInfo.packageHash &&
    latestRollbackInfo.packageHash === packageHash
  );
}

function validateRollbackRetryOptions(rollbackRetryOptions) {
  if (typeof rollbackRetryOptions.delayInHours !== "number") {
    log("The 'delayInHours' rollback retry parameter must be a number.");
    return false;
  }

  if (typeof rollbackRetryOptions.maxRetryAttempts !== "number") {
    log("The 'maxRetryAttempts' rollback retry parameter must be a number.");
    return false;
  }

  if (rollbackRetryOptions.maxRetryAttempts < 1) {
    log(
      "The 'maxRetryAttempts' rollback retry parameter cannot be less then 1."
    );
    return false;
  }

  return true;
}

var testConfig;

// This function is only used for tests. Replaces the default SDK, configuration and native bridge
function setUpTestDependencies(testSdk, providedTestConfig, testNativeBridge) {
  if (testSdk) module.exports.AcquisitionSdk = testSdk;
  if (providedTestConfig) testConfig = providedTestConfig;
  if (testNativeBridge) NativeCodePush = testNativeBridge;
}

async function restartApp(onlyIfUpdateIsPending = false) {
  NativeCodePush.restartApp(onlyIfUpdateIsPending);
}

// This function allows only one syncInternal operation to proceed at any given time.
// Parallel calls to sync() while one is ongoing yields CodePush.SyncStatus.SYNC_IN_PROGRESS.
const sync = (() => {
  let syncInProgress = false;
  const setSyncCompleted = () => {
    syncInProgress = false;
  };

  return (
    options = {},
    syncStatusChangeCallback,
    downloadProgressCallback,
    handleBinaryVersionMismatchCallback
  ) => {
    let syncStatusCallbackWithTryCatch, downloadProgressCallbackWithTryCatch;
    if (typeof syncStatusChangeCallback === "function") {
      syncStatusCallbackWithTryCatch = (...args) => {
        try {
          syncStatusChangeCallback(...args);
        } catch (error) {
          log(`An error has occurred : ${error.stack}`);
        }
      };
    }

    if (typeof downloadProgressCallback === "function") {
      downloadProgressCallbackWithTryCatch = (...args) => {
        try {
          downloadProgressCallback(...args);
        } catch (error) {
          log(`An error has occurred: ${error.stack}`);
        }
      };
    }

    if (syncInProgress) {
      typeof syncStatusCallbackWithTryCatch === "function"
        ? syncStatusCallbackWithTryCatch(CodePush.SyncStatus.SYNC_IN_PROGRESS)
        : log("Sync already in progress.");
      return Promise.resolve(CodePush.SyncStatus.SYNC_IN_PROGRESS);
    }

    syncInProgress = true;
    const syncPromise = syncInternal(
      options,
      syncStatusCallbackWithTryCatch,
      downloadProgressCallbackWithTryCatch,
      handleBinaryVersionMismatchCallback
    );
    syncPromise.then(setSyncCompleted).catch(setSyncCompleted);

    return syncPromise;
  };
})();

/*
 * The syncInternal method provides a simple, one-line experience for
 * incorporating the check, download and installation of an update.
 *
 * It simply composes the existing API methods together and adds additional
 * support for respecting mandatory updates, ignoring previously failed
 * releases, and displaying a standard confirmation UI to the end-user
 * when an update is available.
 */
async function syncInternal(
  options = {},
  syncStatusChangeCallback,
  downloadProgressCallback,
  handleBinaryVersionMismatchCallback
) {
  let resolvedInstallMode;
  const syncOptions = {
    deploymentKey: null,
    ignoreFailedUpdates: true,
    rollbackRetryOptions: null,
    installMode: CodePush.InstallMode.ON_NEXT_RESTART,
    mandatoryInstallMode: CodePush.InstallMode.IMMEDIATE,
    minimumBackgroundDuration: 0,
    updateDialog: null,
    ...options,
  };

  syncStatusChangeCallback =
    typeof syncStatusChangeCallback === "function"
      ? syncStatusChangeCallback
      : (syncStatus) => {
          switch (syncStatus) {
            case CodePush.SyncStatus.CHECKING_FOR_UPDATE:
              log("Checking for update.");
              break;
            case CodePush.SyncStatus.AWAITING_USER_ACTION:
              log("Awaiting user action.");
              break;
            case CodePush.SyncStatus.DOWNLOADING_PACKAGE:
              log("Downloading package.");
              break;
            case CodePush.SyncStatus.INSTALLING_UPDATE:
              log("Installing update.");
              break;
            case CodePush.SyncStatus.UP_TO_DATE:
              log("App is up to date.");
              break;
            case CodePush.SyncStatus.UPDATE_IGNORED:
              log("User cancelled the update.");
              break;
            case CodePush.SyncStatus.UPDATE_INSTALLED:
              if (resolvedInstallMode == CodePush.InstallMode.ON_NEXT_RESTART) {
                log(
                  "Update is installed and will be run on the next app restart."
                );
              } else if (
                resolvedInstallMode == CodePush.InstallMode.ON_NEXT_RESUME
              ) {
                if (syncOptions.minimumBackgroundDuration > 0) {
                  log(
                    `Update is installed and will be run after the app has been in the background for at least ${syncOptions.minimumBackgroundDuration} seconds.`
                  );
                } else {
                  log(
                    "Update is installed and will be run when the app next resumes."
                  );
                }
              }
              break;
            case CodePush.SyncStatus.UNKNOWN_ERROR:
              log("An unknown error occurred.");
              break;
          }
        };

  try {
    await CodePush.notifyApplicationReady();

    syncStatusChangeCallback(CodePush.SyncStatus.CHECKING_FOR_UPDATE);
    const remotePackage = await checkForUpdate(
      syncOptions.deploymentKey,
      handleBinaryVersionMismatchCallback
    );

    const doDownloadAndInstall = async () => {
      syncStatusChangeCallback(CodePush.SyncStatus.DOWNLOADING_PACKAGE);
      const localPackage = await remotePackage.download(
        downloadProgressCallback
      );

      // Determine the correct install mode based on whether the update is mandatory or not.
      resolvedInstallMode = localPackage.isMandatory
        ? syncOptions.mandatoryInstallMode
        : syncOptions.installMode;

      syncStatusChangeCallback(CodePush.SyncStatus.INSTALLING_UPDATE);
      await localPackage.install(
        resolvedInstallMode,
        syncOptions.minimumBackgroundDuration,
        () => {
          syncStatusChangeCallback(CodePush.SyncStatus.UPDATE_INSTALLED);
        }
      );

      return CodePush.SyncStatus.UPDATE_INSTALLED;
    };

    const updateShouldBeIgnored = await shouldUpdateBeIgnored(
      remotePackage,
      syncOptions
    );

    if (!remotePackage || updateShouldBeIgnored) {
      if (updateShouldBeIgnored) {
        log(
          "An update is available, but it is being ignored due to having been previously rolled back."
        );
      }

      const currentPackage = await CodePush.getCurrentPackage();
      if (currentPackage && currentPackage.isPending) {
        syncStatusChangeCallback(CodePush.SyncStatus.UPDATE_INSTALLED);
        return CodePush.SyncStatus.UPDATE_INSTALLED;
      } else {
        syncStatusChangeCallback(CodePush.SyncStatus.UP_TO_DATE);
        return CodePush.SyncStatus.UP_TO_DATE;
      }
    } else if (syncOptions.updateDialog) {
      // updateDialog supports any truthy value (e.g. true, "goo", 12),
      // but we should treat a non-object value as just the default dialog
      if (typeof syncOptions.updateDialog !== "object") {
        syncOptions.updateDialog = CodePush.DEFAULT_UPDATE_DIALOG;
      } else {
        syncOptions.updateDialog = {
          ...CodePush.DEFAULT_UPDATE_DIALOG,
          ...syncOptions.updateDialog,
        };
      }

      return await new Promise((resolve, reject) => {
        let message = null;
        let installButtonText = null;

        const dialogButtons = [];

        if (remotePackage.isMandatory) {
          message = syncOptions.updateDialog.mandatoryUpdateMessage;
          installButtonText =
            syncOptions.updateDialog.mandatoryContinueButtonLabel;
        } else {
          message = syncOptions.updateDialog.optionalUpdateMessage;
          installButtonText =
            syncOptions.updateDialog.optionalInstallButtonLabel;
          // Since this is an optional update, add a button
          // to allow the end-user to ignore it
          dialogButtons.push({
            text: syncOptions.updateDialog.optionalIgnoreButtonLabel,
            onPress: () => {
              syncStatusChangeCallback(CodePush.SyncStatus.UPDATE_IGNORED);
              resolve(CodePush.SyncStatus.UPDATE_IGNORED);
            },
          });
        }

        // Since the install button should be placed to the
        // right of any other button, add it last
        dialogButtons.push({
          text: installButtonText,
          onPress: () => {
            doDownloadAndInstall().then(resolve, reject);
          },
        });

        // If the update has a description, and the developer
        // explicitly chose to display it, then set that as the message
        if (
          syncOptions.updateDialog.appendReleaseDescription &&
          remotePackage.description
        ) {
          message += `${syncOptions.updateDialog.descriptionPrefix} ${remotePackage.description}`;
        }

        syncStatusChangeCallback(CodePush.SyncStatus.AWAITING_USER_ACTION);
        Alert.alert(syncOptions.updateDialog.title, message, dialogButtons);
      });
    } else {
      return await doDownloadAndInstall();
    }
  } catch (error) {
    syncStatusChangeCallback(CodePush.SyncStatus.UNKNOWN_ERROR);
    log(error.message);
    throw error;
  }
}

let CodePush;

/**
 * 커스텀 업데이트 확인 콜백 함수 타입 정의
 * @callback updateChecker
 * @param {UpdateCheckRequest} updateRequest - 업데이트를 확인할 현재 패키지 정보
 * @returns {Promise<{update_info: UpdateCheckResponse}>} 업데이트 확인 결과. AppCenter API 응답 인터페이스를 따릅니다.
 */

/**
 * CodePush 공유 옵션 객체
 * `codePushify`를 호출할 때 옵션을 한 번 전달하면, 관련 함수들과 공유됩니다.
 * @type {Object}
 * @property {string|undefined} bundleHost - 업데이트 파일의 위치를 지정합니다. http 스키마와 호스트를 포함해야 합니다.
 * @property {Function} setBundleHost - bundleHost 값을 설정하는 함수
 * @property {updateChecker|undefined} updateChecker - 커스텀 업데이트 확인 함수
 * @property {Function} setUpdateChecker - updateChecker 값을 설정하는 함수
 */
const sharedCodePushOptions = {
  bundleHost: undefined,
  updateChecker: undefined,
  setUpdateChecker(updateCheckerFunction) {
    if (updateCheckerFunction && typeof updateCheckerFunction !== "function") {
      throw new Error("pass a function to setUpdateChecker");
    }
    this.updateChecker = updateCheckerFunction;
  },
};

function codePushify(options = {}) {
  let React;
  let ReactNative = require("react-native");

  try {
    React = require("react");
  } catch (e) {}
  if (!React) {
    try {
      React = ReactNative.React;
    } catch (e) {}
    if (!React) {
      throw new Error("Unable to find the 'React' module.");
    }
  }

  if (!React.Component) {
    throw new Error(
      `Unable to find the "Component" class, please either:
1. Upgrade to a newer version of React Native that supports it, or
2. Call the codePush.sync API in your component instead of using the @codePush decorator`
    );
  }

  sharedCodePushOptions.setBundleHost(options.bundleHost);
  sharedCodePushOptions.setUpdateChecker(options.updateChecker);

  const decorator = (RootComponent) => {
    class CodePushComponent extends React.Component {
      constructor(props) {
        super(props);
        this.rootComponentRef = React.createRef();
      }

      componentDidMount() {
        if (options.checkFrequency === CodePush.CheckFrequency.MANUAL) {
          CodePush.notifyAppReady();
        } else {
          const rootComponentInstance = this.rootComponentRef.current;

          let syncStatusCallback;
          if (
            rootComponentInstance &&
            rootComponentInstance.codePushStatusDidChange
          ) {
            syncStatusCallback =
              rootComponentInstance.codePushStatusDidChange.bind(
                rootComponentInstance
              );
          }

          let downloadProgressCallback;
          if (
            rootComponentInstance &&
            rootComponentInstance.codePushDownloadDidProgress
          ) {
            downloadProgressCallback =
              rootComponentInstance.codePushDownloadDidProgress.bind(
                rootComponentInstance
              );
          }

          let handleBinaryVersionMismatchCallback;
          if (
            rootComponentInstance &&
            rootComponentInstance.codePushOnBinaryVersionMismatch
          ) {
            handleBinaryVersionMismatchCallback =
              rootComponentInstance.codePushOnBinaryVersionMismatch.bind(
                rootComponentInstance
              );
          }

          CodePush.sync(
            options,
            syncStatusCallback,
            downloadProgressCallback,
            handleBinaryVersionMismatchCallback
          );

          if (
            options.checkFrequency === CodePush.CheckFrequency.ON_APP_RESUME
          ) {
            ReactNative.AppState.addEventListener("change", (newState) => {
              if (newState === "active") {
                CodePush.sync(
                  options,
                  syncStatusCallback,
                  downloadProgressCallback
                );
              }
            });
          }
        }
      }

      render() {
        const props = { ...this.props };

        // We can set ref property on class components only (not stateless)
        // Check it by render method
        if (RootComponent.prototype && RootComponent.prototype.render) {
          props.ref = this.rootComponentRef;
        }

        return <RootComponent {...props} />;
      }
    }

    return hoistStatics(CodePushComponent, RootComponent);
  };

  if (typeof options === "function") {
    // Infer that the root component was directly passed to us.
    return decorator(options);
  } else {
    return decorator;
  }
}

// If the "NativeCodePush" variable isn't defined, then
// the app didn't properly install the native module,
// and therefore, it doesn't make sense initializing
// the JS interface when it wouldn't work anyways.
if (NativeCodePush) {
  CodePush = codePushify;
  Object.assign(CodePush, {
    AcquisitionSdk: Sdk,
    checkForUpdate,
    getConfiguration,
    getCurrentPackage,
    getUpdateMetadata,
    log,
    notifyAppReady: notifyApplicationReady,
    notifyApplicationReady,
    restartApp,
    setUpTestDependencies,
    sync,
    disallowRestart: NativeCodePush.disallow,
    allowRestart: NativeCodePush.allow,
    clearUpdates: NativeCodePush.clearUpdates,
    InstallMode: {
      IMMEDIATE: NativeCodePush.codePushInstallModeImmediate, // Restart the app immediately
      ON_NEXT_RESTART: NativeCodePush.codePushInstallModeOnNextRestart, // Don't artificially restart the app. Allow the update to be "picked up" on the next app restart
      ON_NEXT_RESUME: NativeCodePush.codePushInstallModeOnNextResume, // Restart the app the next time it is resumed from the background
      ON_NEXT_SUSPEND: NativeCodePush.codePushInstallModeOnNextSuspend, // Restart the app _while_ it is in the background,
      // but only after it has been in the background for "minimumBackgroundDuration" seconds (0 by default),
      // so that user context isn't lost unless the app suspension is long enough to not matter
    },
    SyncStatus: {
      UP_TO_DATE: 0, // The running app is up-to-date
      UPDATE_INSTALLED: 1, // The app had an optional/mandatory update that was successfully downloaded and is about to be installed.
      UPDATE_IGNORED: 2, // The app had an optional update and the end-user chose to ignore it
      UNKNOWN_ERROR: 3,
      SYNC_IN_PROGRESS: 4, // There is an ongoing "sync" operation in progress.
      CHECKING_FOR_UPDATE: 5,
      AWAITING_USER_ACTION: 6,
      DOWNLOADING_PACKAGE: 7,
      INSTALLING_UPDATE: 8,
    },
    CheckFrequency: {
      ON_APP_START: 0,
      ON_APP_RESUME: 1,
      MANUAL: 2,
    },
    UpdateState: {
      RUNNING: NativeCodePush.codePushUpdateStateRunning,
      PENDING: NativeCodePush.codePushUpdateStatePending,
      LATEST: NativeCodePush.codePushUpdateStateLatest,
    },
    DeploymentStatus: {
      FAILED: "DeploymentFailed",
      SUCCEEDED: "DeploymentSucceeded",
    },
    DEFAULT_UPDATE_DIALOG: {
      appendReleaseDescription: false,
      descriptionPrefix: " Description: ",
      mandatoryContinueButtonLabel: "Continue",
      mandatoryUpdateMessage: "An update is available that must be installed.",
      optionalIgnoreButtonLabel: "Ignore",
      optionalInstallButtonLabel: "Install",
      optionalUpdateMessage:
        "An update is available. Would you like to install it?",
      title: "Update available",
    },
    DEFAULT_ROLLBACK_RETRY_OPTIONS: {
      delayInHours: 24,
      maxRetryAttempts: 1,
    },
  });
} else {
  log(
    "The CodePush module doesn't appear to be properly installed. Please double-check that everything is setup correctly."
  );
}

module.exports = CodePush;
