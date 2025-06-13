import Semver from "semver";

/**
 * releaseHistory에서 최신 릴리스를 찾는다
 * @param {ReleaseHistoryInterface} releaseHistory
 * @return {[ReleaseVersion, ReleaseInfo]}
 */
function findLatestRelease(releaseHistory) {
  const latestReleaseInfo = Object.entries(releaseHistory)
    .filter(([_, bundle]) => bundle.enabled) // 사용 가능한 릴리스만 필터링
    .sort(([v1], [v2]) => (Semver.gt(v1, v2) ? -1 : 1)) // 최신 버전이 먼저 오도록 정렬
    .at(0); // 가장 첫 번째 항목이 최신 버전

  if (!latestReleaseInfo) {
    throw new Error("최신 릴리스가 존재하지 않습니다.");
  }

  return latestReleaseInfo;
}

/**
 * 현재 실행 중인 버전에 대해 필수 업데이트인지 확인한다
 * @param {ReleaseVersion} runtimeVersion
 * @param {ReleaseHistoryInterface} releaseHistory
 * @return {boolean}
 */
function checkIsMandatory(runtimeVersion, releaseHistory) {
  const sortedMandatoryReleases = Object.entries(releaseHistory)
    .filter(([_, bundle]) => bundle.enabled) // 사용 가능한 릴리스 중에서
    .sort(([v1], [v2]) => (Semver.gt(v1, v2) ? -1 : 1)) // 최신 버전 순 정렬
    .filter(([_, bundle]) => bundle.mandatory); // 필수 업데이트만 필터링

  if (sortedMandatoryReleases.length === 0) {
    return false;
  }

  const [latestMandatoryVersion, _] = sortedMandatoryReleases[0];
  return Semver.gt(latestMandatoryVersion, runtimeVersion); // 현재 버전보다 크면 필수 업데이트
}

/**
 * 롤백을 수행해야 하는지 여부를 판단한다
 * @param {ReleaseVersion} runtimeVersion
 * @param {ReleaseVersion} latestReleaseVersion
 * @return {boolean}
 */
function shouldRollback(runtimeVersion, latestReleaseVersion) {
  // 현재 버전이 최신 릴리스보다 앞서 있을 경우 롤백 필요
  return Semver.lt(latestReleaseVersion, runtimeVersion);
}

export const SemverVersioning = {
  findLatestRelease,
  checkIsMandatory,
  shouldRollback,
};
