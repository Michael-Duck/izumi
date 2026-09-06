//! Windows closes these non-inherited job handles even when Izumi is forcibly terminated.
//! Rust destructors alone cannot stop services after a Tauri dev rebuild or process::exit.

use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::process::{Child, Command};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub(super) fn spawn(command: &mut Command) -> io::Result<(Child, OwnedHandle)> {
    // No name or inheritable security attributes: only this host owns the job's lifetime.
    let handle = unsafe { CreateJobObjectW(None, None) }.map_err(io::Error::from)?;
    // SAFETY: CreateJobObjectW returned a new valid handle; OwnedHandle closes it exactly once.
    let job = unsafe { OwnedHandle::from_raw_handle(handle.0) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: The handle is live and the pointer/size describe the specified information class.
    unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
    }
    .map_err(io::Error::from)?;

    let mut child = command.spawn()?;
    // SAFETY: Child and job own valid handles for the duration of this call.
    if let Err(error) = unsafe { AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle())) } {
        // Never return an unmanaged service when job assignment fails.
        let _ = child.kill();
        let _ = child.wait();
        return Err(io::Error::from(error));
    }
    Ok((child, job))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::WAIT_OBJECT_0;
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    #[test]
    fn killing_host_also_stops_service_without_running_destructors() {
        let module = module_path!().split_once("::").unwrap().1;
        let mut host = Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                &format!("{module}::job_test_host"),
                "--nocapture",
            ])
            .env("IZUMI_JOB_TEST_HOST", "1")
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let output = std::io::BufReader::new(host.stdout.take().unwrap());
        let pid: u32 = output
            .lines()
            .map(Result::unwrap)
            .find_map(|line| line.strip_prefix("IZUMI_JOB_CHILD=").map(str::to_owned))
            .expect("Test host did not report its service")
            .parse()
            .unwrap();
        // Hold a wait handle before killing the host, so process-ID reuse cannot affect the test.
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }.unwrap();
        let service = unsafe { OwnedHandle::from_raw_handle(handle.0) };
        assert_ne!(unsafe { WaitForSingleObject(handle, 0) }, WAIT_OBJECT_0);
        host.kill().unwrap();
        host.wait().unwrap();
        assert_eq!(unsafe { WaitForSingleObject(handle, 5000) }, WAIT_OBJECT_0);
        drop(service);
    }

    #[test]
    #[ignore = "subprocess helper for the forced-host-exit test"]
    fn job_test_host() {
        if std::env::var_os("IZUMI_JOB_TEST_HOST").is_none() {
            return;
        }
        let executable = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/ping.exe");
        let mut command = Command::new(executable);
        command
            .args(["-n", "60", "127.0.0.1"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let (child, _job) = spawn(&mut command).unwrap();
        println!("\nIZUMI_JOB_CHILD={}", child.id());
        std::io::stdout().flush().unwrap();
        // EOF also releases the job if the controlling test fails before terminating this host.
        let _ = std::io::stdin().read_line(&mut String::new());
    }

    #[test]
    fn closing_job_stops_service_and_releases_its_executable() {
        let source = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/ping.exe");
        let executable =
            std::env::temp_dir().join(format!("izumi-service-job-test-{}.exe", std::process::id()));
        std::fs::copy(source, &executable).unwrap();
        let mut command = Command::new(&executable);
        command
            .args(["-n", "60", "127.0.0.1"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let (mut child, job) = spawn(&mut command).unwrap();
        assert!(child.try_wait().unwrap().is_none());
        assert!(std::fs::remove_file(&executable).is_err());

        drop(job);
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().unwrap().is_none() {
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&executable);
                panic!("Service survived closing its job");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        std::fs::remove_file(&executable).unwrap();
    }
}
