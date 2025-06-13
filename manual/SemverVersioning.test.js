import { SemverVersioning } from "./SemverVersioning";

describe("SemverVersioning", () => {
  const MOCK_INFOS = { downloadUrl: "", packageHash: "" };

  describe("findLatestRelease", () => {
    test("릴리스가 없을 때 에러를 던진다", () => {
      const releaseHistory = {};

      expect(() => {
        SemverVersioning.findLatestRelease(releaseHistory);
      }).toThrow("There is no latest release.");
    });

    test("활성화된 릴리스가 없을 때 에러를 던진다", () => {
      const releaseHistory = {
        "1.0.0": { enabled: false, mandatory: false, ...MOCK_INFOS },
        "1.1.0": { enabled: false, mandatory: true, ...MOCK_INFOS },
      };

      expect(() => {
        SemverVersioning.findLatestRelease(releaseHistory);
      }).toThrow("There is no latest release.");
    });

    test("가장 최신의 활성화된 릴리스를 반환한다", () => {
      const releaseHistory = {
        "1.0.0": {
          enabled: true,
          mandatory: false,
          downloadUrl: "R1",
          packageHash: "P1",
        },
        "1.1.0": {
          enabled: true,
          mandatory: false,
          downloadUrl: "R2",
          packageHash: "P2",
        },
        "1.1.1": {
          enabled: true,
          mandatory: true,
          downloadUrl: "R3",
          packageHash: "P3",
        },
      };

      const result = SemverVersioning.findLatestRelease(releaseHistory);

      expect(result).toEqual([
        "1.1.1",
        {
          enabled: true,
          mandatory: true,
          downloadUrl: "R3",
          packageHash: "P3",
        },
      ]);
    });

    test("비활성화된 최신 버전은 제외하고 활성화된 최신 버전을 반환해야 한다", () => {
      const releaseHistory = {
        "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        "1.1.0": { enabled: false, mandatory: false, ...MOCK_INFOS }, // 최신이지만 비활성화
        "1.0.5": { enabled: true, mandatory: true, ...MOCK_INFOS },
      };

      const result = SemverVersioning.findLatestRelease(releaseHistory);

      expect(result[0]).toBe("1.0.5");
    });

    test("시멘틱 버전 정렬이 올바르게 동작해야 한다", () => {
      const releaseHistory = {
        "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        "1.0.10": { enabled: true, mandatory: false, ...MOCK_INFOS },
        "1.0.2": { enabled: true, mandatory: false, ...MOCK_INFOS },
        "1.0.9": { enabled: true, mandatory: false, ...MOCK_INFOS },
      };

      const result = SemverVersioning.findLatestRelease(releaseHistory);

      expect(result[0]).toBe("1.0.10"); // 문자열 정렬이 아닌 세마틱 버전 정렬
    });
  });

  describe("checkIsMandatory", () => {
    describe("필수 업데이트가 아닌 경우", () => {
      test("필수 릴리스가 없는 경우 false를 반환해야 한다", () => {
        const runtimeVersion = "1.0.0";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(false);
      });

      test("현재 버전이 최신 필수 버전과 같은 경우 false를 반환해야 한다", () => {
        const runtimeVersion = "1.1.0";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.0": { enabled: true, mandatory: true, ...MOCK_INFOS },
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(false);
      });

      test("현재 버전이 최신 필수 버전보다 높은 경우 false를 반환해야 한다", () => {
        const runtimeVersion = "1.2.0";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.0": { enabled: true, mandatory: true, ...MOCK_INFOS },
          "1.2.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(false);
      });

      test("비활성화된 필수 릴리스는 무시해야 한다", () => {
        const runtimeVersion = "1.0.0";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.0": { enabled: false, mandatory: true, ...MOCK_INFOS }, // 비활성화된 필수
          "1.2.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(false);
      });

      test("첫 번째 메이저 릴리스만 있는 경우 필수가 아니어야 한다", () => {
        const runtimeVersion = "1.0.0";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS }, // 첫 메이저 릴리스
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(false);
      });
    });

    describe("필수 업데이트인 경우", () => {
      test("현재 버전이 필수 버전보다 낮은 경우 true를 반환해야 한다", () => {
        const runtimeVersion = "1.0.0";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.0": { enabled: true, mandatory: true, ...MOCK_INFOS },
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(true);
      });

      test("여러 필수 버전 중 최신 필수 버전과 비교해야 한다", () => {
        const runtimeVersion = "1.0.5";
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.0.1": { enabled: true, mandatory: true, ...MOCK_INFOS },
          "1.0.5": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.0": { enabled: true, mandatory: true, ...MOCK_INFOS }, // 최신 필수 버전
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(true); // 1.0.5 < 1.1.0 (최신 필수 버전)
      });

      test("프리릴리스 버전도 올바르게 비교해야 한다", () => {
        const runtimeVersion = "1.0.0-beta.1";
        const releaseHistory = {
          "1.0.0-alpha.1": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.0.0-beta.2": { enabled: true, mandatory: true, ...MOCK_INFOS },
        };

        const result = SemverVersioning.checkIsMandatory(
          runtimeVersion,
          releaseHistory
        );

        expect(result).toBe(true);
      });
    });

    describe("실제 시나리오 테스트", () => {
      test("점진적 배포 시나리오: 선택적 → 필수 → 선택적", () => {
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS }, // 초기 릴리스
          "1.0.1": { enabled: true, mandatory: false, ...MOCK_INFOS }, // 선택적 업데이트
          "1.0.2": { enabled: true, mandatory: true, ...MOCK_INFOS }, // 보안 패치 (필수)
          "1.1.0": { enabled: true, mandatory: false, ...MOCK_INFOS }, // 새 기능 (선택적)
        };

        // 1.0.0 → 1.0.2 필수 업데이트 필요
        expect(SemverVersioning.checkIsMandatory("1.0.0", releaseHistory)).toBe(
          true
        );
        expect(SemverVersioning.checkIsMandatory("1.0.1", releaseHistory)).toBe(
          true
        );

        // 1.0.2 이상은 필수 업데이트 불필요
        expect(SemverVersioning.checkIsMandatory("1.0.2", releaseHistory)).toBe(
          false
        );
        expect(SemverVersioning.checkIsMandatory("1.1.0", releaseHistory)).toBe(
          false
        );
      });

      test("여러 필수 버전이 있는 복잡한 시나리오", () => {
        const releaseHistory = {
          "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.0.1": { enabled: true, mandatory: true, ...MOCK_INFOS }, // 첫 번째 필수 버전
          "1.1.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
          "1.1.1": { enabled: true, mandatory: true, ...MOCK_INFOS }, // 두 번째 필수 버전 (최신)
          "1.2.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        };

        // 최신 필수 버전(1.1.1)보다 낮은 모든 버전은 필수 업데이트
        expect(SemverVersioning.checkIsMandatory("1.0.0", releaseHistory)).toBe(
          true
        );
        expect(SemverVersioning.checkIsMandatory("1.0.1", releaseHistory)).toBe(
          true
        );
        expect(SemverVersioning.checkIsMandatory("1.1.0", releaseHistory)).toBe(
          true
        );

        // 최신 필수 버전 이상은 필수 업데이트 불필요
        expect(SemverVersioning.checkIsMandatory("1.1.1", releaseHistory)).toBe(
          false
        );
        expect(SemverVersioning.checkIsMandatory("1.2.0", releaseHistory)).toBe(
          false
        );
      });
    });
  });

  describe("shouldRollback", () => {
    test("최신 버전이 현재 버전보다 낮은 경우 true를 반환해야 한다", () => {
      const runtimeVersion = "1.2.0";
      const latestReleaseVersion = "1.1.0";

      const result = SemverVersioning.shouldRollback(
        runtimeVersion,
        latestReleaseVersion
      );

      expect(result).toBe(true);
    });

    test("최신 버전이 현재 버전과 같은 경우 false를 반환해야 한다", () => {
      const runtimeVersion = "1.1.0";
      const latestReleaseVersion = "1.1.0";

      const result = SemverVersioning.shouldRollback(
        runtimeVersion,
        latestReleaseVersion
      );

      expect(result).toBe(false);
    });

    test("최신 버전이 현재 버전보다 높은 경우 false를 반환해야 한다", () => {
      const runtimeVersion = "1.0.0";
      const latestReleaseVersion = "1.1.0";

      const result = SemverVersioning.shouldRollback(
        runtimeVersion,
        latestReleaseVersion
      );

      expect(result).toBe(false);
    });

    test("프리릴리스 버전 비교가 올바르게 동작해야 한다", () => {
      // 정식 릴리스 → 베타 버전 (롤백)
      expect(SemverVersioning.shouldRollback("1.0.0", "1.0.0-beta.1")).toBe(
        true
      );

      // 베타 2 → 베타 1 (롤백)
      expect(
        SemverVersioning.shouldRollback("1.0.0-beta.2", "1.0.0-beta.1")
      ).toBe(true);

      // 베타 1 → 베타 2 (업데이트)
      expect(
        SemverVersioning.shouldRollback("1.0.0-beta.1", "1.0.0-beta.2")
      ).toBe(false);

      // 베타 → 정식 릴리스 (업데이트)
      expect(SemverVersioning.shouldRollback("1.0.0-beta.1", "1.0.0")).toBe(
        false
      );
    });

    describe("실제 시나리오", () => {
      test("문제가 있는 버전을 비활성화하고 이전 버전으로 롤백하는 경우", () => {
        const runtimeVersion = "1.2.0"; // 사용자가 실행 중인 문제 버전
        const latestReleaseVersion = "1.1.0"; // 문제 버전을 비활성화하고 이전 안정 버전이 최신

        const result = SemverVersioning.shouldRollback(
          runtimeVersion,
          latestReleaseVersion
        );

        expect(result).toBe(true);
      });

      test("정상적인 업데이트 상황", () => {
        const runtimeVersion = "1.0.0";
        const latestReleaseVersion = "1.1.0";

        const result = SemverVersioning.shouldRollback(
          runtimeVersion,
          latestReleaseVersion
        );

        expect(result).toBe(false);
      });
    });
  });

  describe("통합 테스트", () => {
    test("전체 업데이트 플로우 시뮬레이션", () => {
      const releaseHistory = {
        "1.0.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        "1.0.1": { enabled: true, mandatory: true, ...MOCK_INFOS },
        "1.1.0": { enabled: true, mandatory: false, ...MOCK_INFOS },
        "1.2.0": { enabled: false, mandatory: false, ...MOCK_INFOS }, // 문제로 인해 비활성화
      };

      const [latestVersion, latestInfo] =
        SemverVersioning.findLatestRelease(releaseHistory);

      // 1. 최신 활성화된 릴리스 찾기
      expect(latestVersion).toBe("1.1.0"); // 1.2.0은 비활성화되어 제외

      // 2. 각 버전별 필수 업데이트 여부 확인
      expect(SemverVersioning.checkIsMandatory("1.0.0", releaseHistory)).toBe(
        true
      ); // 1.0.1 필수보다 낮음

      expect(SemverVersioning.checkIsMandatory("1.0.1", releaseHistory)).toBe(
        false
      ); // 필수 버전과 동일

      expect(SemverVersioning.checkIsMandatory("1.1.0", releaseHistory)).toBe(
        false
      ); // 필수 버전보다 높음

      // 3. 롤백 필요 여부 확인
      expect(SemverVersioning.shouldRollback("1.2.0", latestVersion)).toBe(
        true
      ); // 문제 버전에서 롤백
      expect(SemverVersioning.shouldRollback("1.1.0", latestVersion)).toBe(
        false
      ); // 최신 버전과 동일
    });
  });

  describe("엣지 케이스", () => {
    test("대용량 릴리스 히스토리 성능 테스트", () => {
      const releaseHistory = {};

      // 1000개의 버전 생성
      for (let major = 1; major <= 10; major++) {
        for (let minor = 0; minor < 10; minor++) {
          for (let patch = 0; patch < 10; patch++) {
            const version = `${major}.${minor}.${patch}`;
            releaseHistory[version] = {
              enabled: true,
              mandatory: patch === 0, // 각 minor의 첫 번째 patch는 필수
              ...MOCK_INFOS,
            };
          }
        }
      }

      const startTime = performance.now();

      const [latestVersion] =
        SemverVersioning.findLatestRelease(releaseHistory);
      const isMandatory = SemverVersioning.checkIsMandatory(
        "1.0.0",
        releaseHistory
      );

      const endTime = performance.now();

      expect(latestVersion).toBe("10.9.9");
      expect(isMandatory).toBe(true);
      expect(endTime - startTime).toBeLessThan(100); // 100ms 이내
    });
  });
});
