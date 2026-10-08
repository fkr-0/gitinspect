//! Pure, serializable GitInspect graph models and bounded metadata transforms.
//! No repository, filesystem or process authority is granted here.
mod compact;
mod delta;
mod model;

pub use compact::*;
pub use delta::*;
pub use model::*;

mod source;
pub use source::*;
